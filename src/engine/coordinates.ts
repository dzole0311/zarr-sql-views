import type { Extent, Volume } from './types';

/** Wrap degrees to the half-open interval [-180, 180). */
export const wrapLongitude = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;

/** Return source indices inside inclusive bounds, including wrapped longitude regions. */
export function coordinateIndices(values: number[], min: number, max: number, longitude = false) {
  return values.flatMap((v, i) => {
    const n = longitude ? wrapLongitude(v) : v;

    return (min <= max ? n >= min && n <= max : n >= min || n <= max) ? [i] : [];
  });
}

/** Enumerate unique chunk coordinates covering a selection in source dimension order.
 * @throws If the selection rank or source indices are invalid. */
export function planChunks(shape: number[], chunks: number[], indices: number[][]) {
  if (indices.length !== shape.length) throw Error('Selection rank differs from array rank.');
  let result: number[][] = [[]];

  indices.forEach((ids, d) => {
    if (ids.some((i) => i < 0 || i >= shape[d] || !Number.isInteger(i)))
      throw Error('Selection is outside array bounds.');
    const unique = [...new Set(ids.map((i) => Math.floor(i / chunks[d])))];
    result = result.flatMap((c) => unique.map((v) => [...c, v]));
  });

  return result;
}

export function sourceOffset(
  indices: number[],
  chunkCoords: number[],
  chunks: number[],
  stride: number[],
) {
  return indices.reduce((offset, n, d) => offset + (n - chunkCoords[d] * chunks[d]) * stride[d], 0);
}

/** Read a canonical [time, latitude, longitude] cell; invalid indices return NaN. */
export function sample(v: Volume, x: number, y: number, t: number) {
  if (
    ![x, y, t].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    t < 0 ||
    x >= v.shape[2] ||
    y >= v.shape[1] ||
    t >= v.shape[0]
  )
    return NaN;

  return v.data[(t * v.shape[1] + y) * v.shape[2] + x];
}

/** Convert supported CF time units to seconds; unrecognized units retain unit scale. */
export function unitSeconds(units: string) {
  if (units.startsWith('microsecond')) return 0.000001;
  if (units.startsWith('millisecond')) return 0.001;
  if (units.startsWith('hour')) return 3600;
  if (units.startsWith('day')) return 86400;
  if (units.startsWith('minute')) return 60;

  return 1;
}

/** Convert a CF time coordinate to UTC, or return its numeric label without an epoch. */
export function coordinateDate(value: number, units: string) {
  const base = units.split('since ')[1];
  if (!base) return String(value);

  return new Date(
    Date.parse(base.endsWith('Z') ? base : base + 'Z') + value * unitSeconds(units) * 1000,
  ).toISOString();
}

/** Validate [west, south, east, north] degrees; west > east crosses the dateline.
 * @throws If bounds are nonfinite, outside geographic limits, or south >= north. */
export function validateExtent(e: Extent) {
  if (
    e.some((v) => !Number.isFinite(v)) ||
    e[1] >= e[3] ||
    e[1] < -90 ||
    e[3] > 90 ||
    e[0] < -180 ||
    e[0] > 180 ||
    e[2] < -180 ||
    e[2] > 180
  )
    throw Error('Choose a valid extent: longitude −180…180 and south < north within −90…90.');
}

/** Locate the selected geographic sample without snapping to another cell outside the region. */
export function pointInVolume(volume: Volume, longitude: number, latitude: number) {
  const x = volume.lon.findIndex((n) => Math.abs(wrapLongitude(n - longitude)) < 1e-6);
  const y = volume.lat.findIndex((n) => Math.abs(n - latitude) < 1e-6);

  return x < 0 || y < 0 ? null : { x, y };
}

/** Copy one spatial cell across all times, retaining source float precision and missing values. */
export function pointForecast(volume: Volume, x: number, y: number): Volume {
  return {
    ...volume,
    data:
      volume.data instanceof Float64Array
        ? Float64Array.from(volume.times, (_, t) => sample(volume, x, y, t))
        : Float32Array.from(volume.times, (_, t) => sample(volume, x, y, t)),
    shape: [volume.times.length, 1, 1],
    lon: [volume.lon[x]],
    lat: [volume.lat[y]],
  };
}
