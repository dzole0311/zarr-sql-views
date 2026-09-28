import { MAX_VOLUME_BYTES, MAX_SELECTION_CHUNKS } from './load-budget';
import { regionGrid } from './region-grid';
import { exampleOptions, isSnowfallExample, snowfallExample } from './examples';
import { resolveAxes, variableDetails } from './datacube';
import { defaultVariable, assertGeographicCoordinates, variableLabel } from './dataset-support';
import { timeWindow, windowTimeCoordinates } from './time-window';
import { forecastStart } from './forecast-coverage';
import * as z from 'zarrita';
import { BudgetCache, Scheduler, chunkKey } from './cache';
import { planChunks, sourceOffset, validateExtent, unitSeconds } from './coordinates';
import { resolveStore } from './resolve';
import type { Metadata, Metrics, OpenRequest, Request, Response, Volume, Extent } from './types';
import type { Readable, AbsolutePath, RangeQuery } from '@zarrita/storage';

const MB = 1024 * 1024;

const bytes = new BudgetCache<Uint8Array>(48 * MB),
  decoded = new BudgetCache<z.Chunk<z.DataType>>(128 * MB);

const network = new Scheduler(4),
  decode = new Scheduler(2);

let metadata: Metadata, store: Readable, root: z.Location<Readable>;

const arrays = new Map<string, z.Array<z.DataType>>();

const aborts = new Map<number, AbortController>();

const metrics: Metrics = {
  requests: 0,
  responseBytes: 0,
  decodedBytes: 0,
  byteCacheBytes: 0,
  cacheHits: 0,
  decodeMs: 0,
  openMs: 0,
  loadMs: 0,
  snapshot: '',
  transferBytes: 0,
  cpuDecodeMs: 0,
  coalescedRequests: 0,
};

for (const [name, factory] of z.registry) {
  z.registry.set(name, async () => {
    const entry = await factory();

    return {
      kind: entry.kind,
      fromConfig: (config, meta) => {
        const codec = entry.fromConfig(config, meta);
        const original = codec.decode.bind(codec);

        codec.decode = async (...args: Parameters<typeof original>) => {
          const start = performance.now();
          try {
            return await original(...args);
          } finally {
            metrics.cpuDecodeMs += performance.now() - start;
          }
        };

        return codec;
      },
    };
  });
}

const nativeFetch = self.fetch.bind(self);

self.fetch = async (...args: Parameters<typeof fetch>) => {
  metrics.requests++;
  const response = await nativeFetch(...args);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length)) metrics.responseBytes += length;

  return response;
};

function report(): Metrics {
  metrics.decodedBytes = decoded.bytes;
  metrics.byteCacheBytes = bytes.bytes;
  metrics.cacheHits = decoded.hits + bytes.hits;
  metrics.transferBytes = performance
    .getEntriesByType('resource')
    .reduce((n, e) => n + (e as PerformanceResourceTiming).transferSize, 0);

  return { ...metrics };
}

function send(message: Response, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

/** Wrap store reads with byte-budgeted caching and request deduplication, preserving ranges. */
function cachedStore(raw: Readable, prefix: string): Readable {
  const get = (key: AbsolutePath, range?: RangeQuery) => {
    const identity = JSON.stringify([prefix, key, range]);
    const hit = bytes.get(identity);
    if (hit) return Promise.resolve(hit);

    return network.run(identity, async () => {
      const value = range && raw.getRange ? await raw.getRange(key, range) : await raw.get(key);
      if (value) bytes.set(identity, value, value.byteLength);

      return value ?? undefined;
    });
  };

  return {
    get: (key) => get(key),
    ...(raw.getRange
      ? { getRange: (key: AbsolutePath, range: RangeQuery) => get(key, range) }
      : {}),
  };
}

async function array(name: string) {
  let a = arrays.get(name);
  if (!a) {
    a = await z.open(root.resolve(name), { kind: 'array' });
    arrays.set(name, a);
  }

  return a;
}

/** Read a one-dimensional coordinate array within the coordinate or recent-history budget. */
async function coord(name: string, recent = false) {
  const a = await array(name);
  if (a.shape.length !== 1) throw Error(`Coordinate ${name} must be one-dimensional.`);
  const window = timeWindow(a.shape[0], !recent);
  if (window.stop - window.start > 100000)
    throw Error(`Coordinate ${name} exceeds the 100,000-value coordinate budget.`);
  const d = await z.get(a, [z.slice(window.start, window.stop)]);

  return {
    values: Array.from(d.data as ArrayLike<number | bigint>, Number),
    units: String(a.attrs.units || ''),
    attrs: a.attrs,
    start: window.start,
    length: a.shape[0],
  };
}

async function open(options: OpenRequest, id: number) {
  options = exampleOptions(options);
  const start = performance.now();
  arrays.clear();
  decoded.clear();
  bytes.clear();
  send({ id, type: 'progress', message: 'Resolving dataset and reading coordinates…' });
  const resolved = await resolveStore(options.url);
  let snapshot = `session-${Date.now()}`;
  let names = isSnowfallExample(options.url) ? snowfallExample.variables : resolved.variables;
  if (resolved.icechunk) {
    if (!self.crossOriginIsolated)
      throw Error(
        'Icechunk requires cross-origin isolation. Serve COOP: same-origin and COEP: credentialless headers over HTTPS or localhost.',
      );

    const [{ Repository }, { createFetchStorage }] = await Promise.all([
      import('@earthmover/icechunk'),
      import('@earthmover/icechunk/fetch-storage'),
    ]);

    const repo = await Repository.open(createFetchStorage(resolved.url), {
      maxConcurrentRequests: 4,
      maxConcurrentDecodes: 2,
      caching: {
        numBytesChunks: 8 * MB,
        numBytesAttributes: 4 * MB,
        numChunkRefs: 200000,
        numSnapshotNodes: 2000,
      },
    });

    const session = await repo.readonlySession({ branch: 'main' });
    snapshot = session.snapshotId;
    const raw = session.store;

    store = cachedStore(
      {
        get: async (key) => (await raw.get(key)) ?? undefined,
        getRange: async (key, range) => (await raw.getRange(key, range)) ?? undefined,
      },
      resolved.url + snapshot,
    );

    if (!names.length) names = (await raw.listDir('')).filter((n) => n !== 'zarr.json');
  } else {
    const raw = new z.FetchStore(resolved.url);
    store = cachedStore(raw, resolved.url + snapshot);
    if (!names.length) {
      const v3 = await store.get('/zarr.json');
      if (v3) {
        const doc = JSON.parse(new TextDecoder().decode(v3));
        names = Object.keys(doc.consolidated_metadata?.metadata || {}).filter(
          (k) => !k.includes('/'),
        );
      }

      if (!names.length) {
        const v2 = await store.get('/.zmetadata');
        if (v2) {
          const doc = JSON.parse(new TextDecoder().decode(v2));
          names = Object.keys(doc.metadata || {})
            .filter((n) => n.endsWith('/.zarray'))
            .map((n) => n.replace('/.zarray', ''));
        }
      }
    }
  }

  const asyncStore = {
    get: async (key: AbsolutePath) => (await store.get(key)) ?? undefined,
    ...(store.getRange
      ? {
          getRange: async (key: AbsolutePath, range: RangeQuery) =>
            (await store.getRange!(key, range)) ?? undefined,
        }
      : {}),
  };

  root = z.root(
    z.withRangeCoalescing(asyncStore, {
      coalesceSize: 16384,
      onFlush: (r) => {
        metrics.coalescedRequests += r.requestCount - r.groupCount;
      },
    }),
  );

  let variable =
    options.variable ||
    defaultVariable(names.filter((name) => resolved.cube.variables[name]?.type !== 'auxiliary'));
  if (!variable)
    throw Error('This store cannot list arrays. Enter an explicit array path under Advanced.');
  const a = await array(variable);
  if (
    (a.dimensionNames || (a.attrs._ARRAY_DIMENSIONS as string[]) || []).includes('ensemble_member')
  )
    throw Error(
      'This dataset contains ensemble members. Ensemble member selection is not supported yet; choose a single-forecast or analysis dataset.',
    );

  if (a.shape.length < 3 || a.shape.length > 4)
    throw Error(
      'Supported arrays have three axes, optionally plus one initialization axis. Select an explicit 3D/4D array.',
    );

  const dimensions = a.dimensionNames || (a.attrs._ARRAY_DIMENSIONS as string[]);
  const axes = resolveAxes(dimensions, resolved.cube, variable, options.axes);

  const [x, y, t, init] = await Promise.all([
    coord(axes.x),
    coord(axes.y),
    coord(axes.t, !axes.init),
    axes.init ? coord(axes.init) : Promise.resolve({ values: [0], units: '' }),
  ]);

  for (const [name, c] of [
    [axes.x, x],
    [axes.y, y],
    [axes.t, t],
  ] as const) {
    if (c.length !== a.shape[dimensions.indexOf(name)] || c.values.some((v) => !Number.isFinite(v)))
      throw Error(`Invalid or missing coordinates for ${name}.`);
  }
  assertGeographicCoordinates(x.attrs, y.attrs);
  let complete: number[] = [];
  let availability =
    'Availability metadata unavailable; each regional block is verified across all lead times.';
  if (names.includes('ingested_forecast_length')) {
    const av = await coord('ingested_forecast_length');
    const max = Math.max(...t.values) * unitSeconds(t.units);
    complete = av.values.flatMap((v, i) =>
      Number.isFinite(v) && v * unitSeconds(av.units) >= max ? [i] : [],
    );
    if (complete.length)
      availability =
        'Forecast length verified from ingestion metadata; regional values checked on load.';
  }

  if (t.values.some((v, i) => i > 0 && v <= t.values[i - 1]))
    throw Error('Time coordinates must be strictly increasing; irregular intervals are supported.');
  for (const c of [x, y]) {
    const step = c.values[1] - c.values[0];
    if (c.values.some((v, i) => i > 0 && Math.abs(v - c.values[i - 1] - step) > 1e-6))
      throw Error(
        'Irregular spatial grids are not supported in this milestone. Use a rectilinear, regularly spaced grid.',
      );
  }
  const variables = [];
  for (const name of names) {
    if (resolved.cube.variables[name]?.type === 'auxiliary') continue;
    try {
      const item = await array(name);
      const details = variableDetails(resolved.cube, name, item.attrs);
      if (isSnowfallExample(options.url)) {
        const disabledReason =
          item.shape.length !== 3
            ? `${item.shape.length}D array — the cube currently requires latitude, longitude and winter dimensions.`
            : undefined;

        if (!disabledReason)
          resolveAxes(
            item.dimensionNames || (item.attrs._ARRAY_DIMENSIONS as string[] | undefined),
            resolved.cube,
            name,
            exampleOptions({ url: options.url, variable: name }).axes,
          );

        variables.push({
          name,
          label: variableLabel(name, item.attrs.long_name),
          units: String(item.attrs.units || ''),
          disabledReason,
        });

        continue;
      }

      resolveAxes(
        item.dimensionNames || (item.attrs._ARRAY_DIMENSIONS as string[] | undefined),
        resolved.cube,
        name,
        options.axes,
      );

      if (
        item.shape.length === a.shape.length &&
        JSON.stringify(item.dimensionNames || item.attrs._ARRAY_DIMENSIONS) ===
          JSON.stringify(dimensions)
      )
        variables.push({
          name,
          label: variableLabel(name, details.label),
          units: details.units,
        });
    } catch {}
  }
  if (!variables.some((v) => v.name === variable))
    variables.unshift({
      name: variable,
      label: variableLabel(variable, variableDetails(resolved.cube, variable, a.attrs).label),
      units: variableDetails(resolved.cube, variable, a.attrs).units,
    });

  variables.sort((a, b) =>
    a.name === 'temperature_2m' ? -1 : b.name === 'temperature_2m' ? 1 : 0,
  );
  const timeUnits =
    isSnowfallExample(options.url) && ['winter', 'year'].includes(axes.t) ? 'winter year' : t.units;
  const time = windowTimeCoordinates(t.values, timeUnits, t.start, !!axes.init);
  const raw = await store.get(`/${variable}/zarr.json` as AbsolutePath);

  metadata = {
    url: options.url,
    storeUrl: resolved.url,
    title: isSnowfallExample(options.url) ? snowfallExample.title : resolved.title,
    snapshot,
    variables,
    variable,
    shape: a.shape,
    chunks: a.chunks,
    dtype: a.dtype,
    dimensions,
    axes,
    lon: x.values,
    lat: y.values,
    times: time.values,
    timeIndices: time.indices,
    timeUnits: time.units,
    initializations: init.values,
    initUnits: init.units,
    complete,
    availability,
    units: variableDetails(resolved.cube, variable, a.attrs).units,
    codecs: raw ? JSON.parse(new TextDecoder().decode(raw)).codecs : 'Zarr v2',
  };

  metrics.snapshot = snapshot;
  metrics.openMs = performance.now() - start;
  send({ id, type: 'metadata', metadata, metrics: report() });
}

/** Read and cache a decoded source chunk within the allocation budget.
 * Consumer cancellation detaches from shared work without cancelling other readers. */
async function chunk(a: z.Array<z.DataType>, coords: number[], signal: AbortSignal) {
  const key = chunkKey(metadata.storeUrl, metadata.snapshot, a.path, coords);
  const hit = decoded.get(key);
  if (hit) return hit;
  const size = a.chunks.reduce((v, n) => v * n, 1) * (a.dtype === 'float64' ? 8 : 4);
  if (size > 96 * MB)
    throw Error(
      `A source chunk requires ${(size / MB).toFixed(0)} MiB, beyond the 96 MiB safety limit. Use an existing overview or a better-chunked store.`,
    );

  return decode.run(
    key,
    async () => {
      const start = performance.now();
      const value = await a.getChunk(coords);
      metrics.decodeMs += performance.now() - start;
      const n = (value.data as Float32Array).byteLength || size;
      decoded.set(key, value, n);

      return value;
    },
    signal,
  );
}

async function load(
  variable: string,
  init: number,
  extent: Extent,
  id: number,
  signal: AbortSignal,
) {
  const start = performance.now();
  validateExtent(extent);
  const a = await array(variable);
  if (!a.is('number')) throw Error(`Unsupported data type ${a.dtype}; select a numeric array.`);
  const dims = a.dimensionNames || (a.attrs._ARRAY_DIMENSIONS as string[]);
  if (JSON.stringify(dims) !== JSON.stringify(metadata.dimensions))
    throw Error('Variable axes differ. Reopen the dataset with this array path.');
  const { axes } = metadata;
  const longitude = regionGrid(metadata.lon, extent[0], extent[2], true);
  const latitude = regionGrid(metadata.lat, extent[1], extent[3]);
  const x = longitude.indices;
  const y = latitude.indices;
  const t = metadata.timeIndices ?? metadata.times.map((_, i) => i);
  if (!x.some((i) => i >= 0) || !y.some((i) => i >= 0))
    throw Error('This region contains no coordinate samples. Choose an extent inside the dataset.');
  const count = x.length * y.length * t.length;
  const width = a.dtype === 'float64' ? 8 : 4;
  if (count * width > MAX_VOLUME_BYTES)
    throw Error(
      'This selection exceeds the 64 MiB volume budget. Choose a smaller region; source chunk transfer may remain larger.',
    );

  if (!Number.isInteger(init) || init < 0 || init >= metadata.initializations.length)
    throw Error('Initialization is outside available coordinates.');

  const indices = dims.map((d) =>
    d === axes.x
      ? x.filter((i) => i >= 0)
      : d === axes.y
        ? y.filter((i) => i >= 0)
        : d === axes.t
          ? t
          : [init],
  );

  const planned = planChunks(a.shape, a.chunks, indices);
  if (planned.length > MAX_SELECTION_CHUNKS)
    throw Error(
      `This selection spans more than ${MAX_SELECTION_CHUNKS} chunks. Choose a smaller region.`,
    );

  send({
    id,
    type: 'progress',
    message: `Reading ${planned.length} source ${planned.length === 1 ? 'block' : 'blocks'} · checking all ${t.length} time steps…`,
  });

  const data = a.dtype === 'float64' ? new Float64Array(count) : new Float32Array(count);
  data.fill(NaN);
  const axisX = dims.indexOf(axes.x),
    axisY = dims.indexOf(axes.y),
    axisT = dims.indexOf(axes.t);
  let finished = 0;

  await Promise.all(
    planned.map(async (coords) => {
      const c = await chunk(a, coords, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

      const xs = x.flatMap((n, i) =>
          Math.floor(n / a.chunks[axisX]) === coords[axisX] ? [i] : [],
        ),
        ys = y.flatMap((n, i) => (Math.floor(n / a.chunks[axisY]) === coords[axisY] ? [i] : [])),
        ts = t.flatMap((source, local) =>
          Math.floor(source / a.chunks[axisT]) === coords[axisT] ? [{ source, local }] : [],
        );

      for (const ti of ts)
        for (const yi of ys)
          for (const xi of xs) {
            const source = dims.map((d) =>
              d === axes.x ? x[xi] : d === axes.y ? y[yi] : d === axes.t ? ti.source : init,
            );
            const v = Number(
              (c.data as ArrayLike<number>)[sourceOffset(source, coords, a.chunks, c.stride)],
            );
            data[(ti.local * y.length + yi) * x.length + xi] = v === a.fillValue ? NaN : v;
          }
      send({ id, type: 'progress', message: `Loaded ${++finished} of ${planned.length} blocks…` });
    }),
  );

  let min = Infinity,
    max = -Infinity,
    missing = 0;
  const coverage = new Uint32Array(t.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      coverage[Math.floor(i / (x.length * y.length))]++;
    } else missing++;
  }
  if (!Number.isFinite(min))
    throw Error(
      'No source values exist for this initialization and region. Choose an earlier initialization.',
    );

  const startStep = axes.init ? forecastStart(coverage, metadata.times, a.attrs) : 0;

  const loadedData = startStep ? data.slice(startStep * x.length * y.length) : data;
  const loadedTimes = metadata.times.slice(startStep);
  missing -= startStep * x.length * y.length;

  const volume: Volume = {
    id: chunkKey(metadata.storeUrl, metadata.snapshot, variable, [init, ...extent]),
    data: loadedData,
    shape: [loadedTimes.length, y.length, x.length],
    spatialCoverage: [
      x.findIndex((i) => i >= 0),
      y.findIndex((i) => i >= 0),
      x.length - 1 - [...x].reverse().findIndex((i) => i >= 0),
      y.length - 1 - [...y].reverse().findIndex((i) => i >= 0),
    ],
    lon: longitude.values,
    lat: latitude.values,
    times: loadedTimes,
    timeUnits: metadata.timeUnits,
    init,
    extent,
    min,
    max,
    missing,
    units: String(
      a.attrs.units || metadata.variables.find((v) => v.name === variable)?.units || '',
    ),
    variable,
  };

  metrics.loadMs = performance.now() - start;
  send({ id, type: 'volume', volume, metrics: report() }, [loadedData.buffer as ArrayBuffer]);
}

let opening: Promise<void> | undefined;

let loads = 0;

self.onmessage = (event: MessageEvent<Request>) => {
  const r = event.data;
  if (r.type === 'stats') {
    send({ id: r.id, type: 'stats', metrics: report() });

    return;
  }

  if (r.type === 'cancel') {
    aborts.get(r.target)?.abort();

    return;
  }

  const controller = new AbortController();
  aborts.set(r.id, controller);

  const execute = async () => {
    if (r.type === 'open') {
      opening = open(r.options, r.id);
      await opening;
    } else {
      await opening;
      if (!metadata) throw Error('Open a dataset first.');
      if (++loads % 32 === 0) arrays.clear();
      await load(r.variable, r.init, r.extent, r.id, controller.signal);
    }
  };

  execute()
    .catch((e) => {
      if (!controller.signal.aborted)
        send({ id: r.id, type: 'error', message: (e as Error).message || String(e) });
    })
    .finally(() => aborts.delete(r.id));
};
