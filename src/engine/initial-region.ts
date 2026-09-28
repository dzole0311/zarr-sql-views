import { MAX_VOLUME_BYTES, MAX_SELECTION_CHUNKS } from './load-budget';
import { regionGrid } from './region-grid';
import { coordinateIndices, planChunks, wrapLongitude } from './coordinates';
import type { Extent, Metadata } from './types';

/** Keep the requested view where possible; otherwise start inside the source grid. */
export function initialRegion(meta: Metadata, requested: Extent): Extent {
  const longitude = meta.lon
    .map((value, index) => ({ value: wrapLongitude(value), index }))
    .sort((a, b) => a.value - b.value);

  let cut = 0,
    gap = -1;

  longitude.forEach((p, i) => {
    const next =
      longitude[(i + 1) % longitude.length].value + (i === longitude.length - 1 ? 360 : 0);
    if (next - p.value > gap) {
      gap = next - p.value;
      cut = (i + 1) % longitude.length;
    }
  });

  const lonOrder = [...longitude.slice(cut), ...longitude.slice(0, cut)].map((p) => p.index);
  const latOrder = meta.lat.map((_, i) => i).sort((a, b) => meta.lat[a] - meta.lat[b]);

  const center = (ids: number[], count: number) => {
    const start = Math.max(0, Math.floor((ids.length - count) / 2));

    return ids.slice(start, start + count);
  };

  const pickedX = new Set(coordinateIndices(meta.lon, requested[0], requested[2], true));
  const pickedY = new Set(coordinateIndices(meta.lat, requested[1], requested[3]));
  let x = lonOrder.filter((i) => pickedX.has(i));
  let y = latOrder.filter((i) => pickedY.has(i));
  const spanX = (requested[2] - requested[0] + 360) % 360 || 360;
  if (x.length < 2)
    x = center(
      lonOrder,
      Math.min(
        lonOrder.length,
        Math.max(2, Math.ceil(spanX / Math.abs(meta.lon[1] - meta.lon[0])) + 1),
      ),
    );

  if (y.length < 2)
    y = center(
      latOrder,
      Math.min(
        latOrder.length,
        Math.max(
          2,
          Math.ceil((requested[3] - requested[1]) / Math.abs(meta.lat[1] - meta.lat[0])) + 1,
        ),
      ),
    );

  const fits = () => {
    if (
      x.length * y.length * meta.times.length * (meta.dtype === 'float64' ? 8 : 4) >
      MAX_VOLUME_BYTES
    )
      return false;

    const indices = meta.dimensions.map((d) =>
      d === meta.axes.x
        ? x
        : d === meta.axes.y
          ? y
          : d === meta.axes.t
            ? (meta.timeIndices ?? meta.times.map((_, i) => i))
            : [0],
    );

    return planChunks(meta.shape, meta.chunks, indices).length <= MAX_SELECTION_CHUNKS;
  };

  while (!fits() && (x.length > 2 || y.length > 2)) {
    if (x.length >= y.length && x.length > 2) x = center(x, Math.max(2, Math.ceil(x.length / 2)));
    else y = center(y, Math.max(2, Math.ceil(y.length / 2)));
  }
  if (!fits())
    throw Error(
      `The time selection alone exceeds the ${MAX_SELECTION_CHUNKS}-chunk loading budget. A smaller geographic region cannot reduce it; choose a materialized dataset.`,
    );

  if (!x.length || y.length < 2)
    throw Error('This dataset needs at least two latitude samples to display a region.');

  if (x.length === pickedX.size && y.length === pickedY.size) {
    const width = regionGrid(meta.lon, requested[0], requested[2], true).indices.length;
    const height = regionGrid(meta.lat, requested[1], requested[3]).indices.length;
    if (width * height * meta.times.length * (meta.dtype === 'float64' ? 8 : 4) <= MAX_VOLUME_BYTES)
      return requested;
  }

  return [
    wrapLongitude(meta.lon[x[0]]),
    meta.lat[y[0]],
    wrapLongitude(meta.lon[x.at(-1)!]),
    meta.lat[y.at(-1)!],
  ];
}
