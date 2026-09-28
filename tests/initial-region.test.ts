import { expect, it } from 'vitest';
import { initialRegion } from '../src/engine/initial-region';
import { coordinateIndices } from '../src/engine/coordinates';
import type { Metadata } from '../src/engine/types';
function grid(lon: number[], lat: number[], nt = 61): Metadata {
  return {
    lon,
    lat,
    times: Array.from({ length: nt }, (_, i) => i),
    axes: { x: 'lon', y: 'lat', t: 'time' },
    dimensions: ['time', 'lat', 'lon'],
    shape: [nt, lat.length, lon.length],
    chunks: [nt, 50, 50],
    dtype: 'float32',
  } as Metadata;
}
it('keeps Europe for global grids', () => {
  const m = grid(
    Array.from({ length: 360 }, (_, i) => i),
    Array.from({ length: 181 }, (_, i) => i - 90),
  );
  expect(initialRegion(m, [-25, 34, 45, 72])).toEqual([-25, 34, 45, 72]);
});
it('recenters Europe inside a North American regional grid with 0 to 360 longitudes', () => {
  const m = grid(
    Array.from({ length: 61 }, (_, i) => 230 + i),
    Array.from({ length: 31 }, (_, i) => 25 + i),
  );
  const e = initialRegion(m, [-25, 34, 45, 72]);
  expect(e[0]).toBe(-130);
  expect(e[2]).toBe(-70);
  expect(coordinateIndices(m.lon, e[0], e[2], true).length).toBeGreaterThan(1);
});
it('supports a regional grid crossing the dateline', () => {
  const m = grid([170, 175, 180, 185, 190], [-10, -5, 0, 5, 10]);
  expect(initialRegion(m, [-25, 34, 45, 72])).toEqual([170, -10, -170, 10]);
});
it('bounds high resolution starting regions to the volume budget', () => {
  const m = grid(
    Array.from({ length: 2000 }, (_, i) => -130 + i * 0.03),
    Array.from({ length: 1000 }, (_, i) => 25 + i * 0.03),
  );
  const e = initialRegion(m, [-25, 34, 45, 72]);
  const count =
    coordinateIndices(m.lon, e[0], e[2], true).length * coordinateIndices(m.lat, e[1], e[3]).length;
  expect(count * 61 * 4).toBeLessThanOrEqual(64 * 1024 * 1024);
});
it('accepts all 66 one-chunk-per-winter layers and rejects a 67th chunk', () => {
  const m = grid([-110, -109], [40, 41], 66);
  m.chunks = [1, 2, 2];
  expect(initialRegion(m, [-110, 40, -109, 41])).toEqual([-110, 40, -109, 41]);
  m.times.push(66);
  m.shape[0] = 67;
  expect(() => initialRegion(m, [-110, 40, -109, 41])).toThrow('66-chunk loading budget');
});
it('accounts for empty padding in the initial volume allocation budget', () => {
  const m = grid([0, 0.01, 0.02], [40, 40.01, 40.02], 66);
  const region = initialRegion(m, [-10, 30, 10, 50]);
  [0, 40, 0.02, 40.02].forEach((value, axis) => expect(region[axis]).toBeCloseTo(value));
});
