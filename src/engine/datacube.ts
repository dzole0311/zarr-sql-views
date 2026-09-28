import type { Axes } from './types';

type Fields = Record<string, unknown>;

export type Datacube = { dimensions: Record<string, Fields>; variables: Record<string, Fields> };

const record = (value: unknown): value is Fields =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Asset fields take precedence over Collection fields or Item properties. */
export function readDatacube(parent: Fields, asset: Fields): Datacube {
  const read = (key: string) => {
    const value = Object.hasOwn(asset, key) ? asset[key] : parent[key];
    if (value === undefined) return {};
    if (!record(value) || Object.values(value).some((entry) => !record(entry)))
      throw Error(`Invalid STAC ${key}: expected a map of objects.`);

    return value as Record<string, Fields>;
  };

  return { dimensions: read('cube:dimensions'), variables: read('cube:variables') };
}

/** Use declarations as semantic hints, never as the storage order of the Zarr array. */
export function resolveAxes(
  names: string[] | undefined,
  cube: Datacube,
  variable: string,
  provided?: Axes,
): Axes {
  if (!names) throw Error('Zarr dimension names are required to map STAC dimensions to the array.');
  const declared = cube.variables[variable]?.dimensions;
  if (
    declared !== undefined &&
    (!Array.isArray(declared) ||
      declared.length !== names.length ||
      new Set(declared).size !== names.length ||
      declared.some((name) => !names.includes(name)))
  )
    throw Error(`STAC dimensions for ${variable} do not match the Zarr array.`);

  const entries = names.flatMap((name) =>
    cube.dimensions[name] ? [[name, cube.dimensions[name]] as const] : [],
  );

  const unique = (matches: string[], role: string) => {
    if (matches.length > 1)
      throw Error(
        `Ambiguous ${role} dimensions: ${matches.join(', ')}. Supply an explicit axis mapping.`,
      );

    return matches[0];
  };

  const conventional = (candidates: string[]) =>
    unique(
      names.filter((n) => candidates.includes(n)),
      'axis',
    );

  const spatial = (axis: string, fallback: string[]) =>
    unique(
      entries.filter(([, d]) => d.type === 'spatial' && d.axis === axis).map(([n]) => n),
      axis,
    ) ?? conventional(fallback);

  let axes = provided;
  if (!axes) {
    const x = spatial('x', ['longitude', 'lon', 'x']);
    const y = spatial('y', ['latitude', 'lat', 'y']);
    const init =
      names.length === 4 ? conventional(['init_time', 'forecast_reference_time']) : undefined;
    const lead = conventional(['lead_time', 'forecast_period']);
    const temporal = entries
      .filter(([n, d]) => d.type === 'temporal' && n !== init)
      .map(([n]) => n);
    const t = lead ?? unique(temporal, 'temporal') ?? conventional(['time']);
    if (!x || !y || !t)
      throw Error(
        `Axis mapping required for [${names.join(', ')}]. Supply longitude, latitude, time and optional initialization dimensions.`,
      );

    axes = { x, y, t, ...(init ? { init } : {}) };
  }

  const selected = [axes.x, axes.y, axes.t, ...(axes.init ? [axes.init] : [])];
  if (
    selected.length !== names.length ||
    new Set(selected).size !== names.length ||
    selected.some((n) => !names.includes(n))
  )
    throw Error('Axis mappings must cover each Zarr dimension exactly once.');

  for (const [name, axis] of [
    [axes.x, 'x'],
    [axes.y, 'y'],
  ] as const) {
    const d = cube.dimensions[name];
    if (!d) continue;
    if (d.type !== 'spatial' || d.axis !== axis)
      throw Error(`STAC dimension ${name} is not a spatial ${axis} axis.`);
    const crs = d.reference_system ?? 4326;
    if (crs !== 4326 && crs !== 'EPSG:4326')
      throw Error(
        `Unsupported STAC reference system for ${name}; only EPSG:4326 longitude/latitude is supported.`,
      );
  }

  return axes;
}

/** Zarr units describe stored values; STAC supplies missing display metadata only. */
export function variableDetails(cube: Datacube, name: string, attrs: Fields) {
  const v = cube.variables[name];

  return {
    label: attrs.long_name ?? v?.long_name ?? v?.description,
    units: String(attrs.units || v?.unit || ''),
  };
}
