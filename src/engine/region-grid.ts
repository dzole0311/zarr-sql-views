import { wrapLongitude } from './coordinates';

/** Preserve the requested regular grid at source edges. -1 marks a cell outside coverage. */
export function regionGrid(source: number[], min: number, max: number, longitude = false) {
  const signedStep = (source.at(-1)! - source[0]) / (source.length - 1);
  const step = Math.abs(signedStep);
  if (!Number.isFinite(step) || step <= 0)
    throw Error('A regular spatial grid needs at least two coordinates.');
  const anchor = longitude ? wrapLongitude(source[0]) : source[0];
  const span = longitude ? (max - min + 360) % 360 || 360 : max - min;
  const tolerance = Math.max(1e-6, step * 1e-5);
  const first = Math.ceil((min - anchor - tolerance) / step);
  const last = Math.floor((min + span - anchor + tolerance) / step);
  const length = last - first + 1;
  if (length < 1 || length > 100000)
    throw Error('Requested region exceeds the spatial coordinate budget.');
  const values: number[] = [];
  const indices: number[] = [];
  const offsets = longitude ? [0, -360, 360] : [0];
  for (let n = first; n <= last; n++) {
    const value = anchor + n * step;
    let index = -1;
    for (const offset of offsets) {
      const candidate = Math.round((n * step + offset) / signedStep);
      if (candidate < 0 || candidate >= source.length) continue;
      const difference = source[candidate] - value;
      if (Math.abs(longitude ? wrapLongitude(difference) : difference) <= tolerance) {
        index = Math.max(0, candidate);
        break;
      }
    }
    indices.push(index);
    values.push(index >= 0 ? source[index] : longitude ? wrapLongitude(value) : value);
  }
  if (
    longitude &&
    values.length > 1 &&
    Math.abs(wrapLongitude(values.at(-1)! - values[0])) <= tolerance
  ) {
    values.pop();
    indices.pop();
  }

  return { values, indices };
}
