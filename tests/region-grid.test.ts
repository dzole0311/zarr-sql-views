import { expect, it } from 'vitest';
import { regionGrid } from '../src/engine/region-grid';
it('preserves a full viewport when only a narrow source strip is available', () => {
  expect(regionGrid([-52, -51, -50], -51, -47, true)).toEqual({
    values: [-51, -50, -49, -48, -47],
    indices: [1, 2, -1, -1, -1],
  });
});
it('keeps descending latitude arrays in ascending display order with empty edge cells', () => {
  expect(regionGrid([42, 41, 40], 39, 43)).toEqual({
    values: [39, 40, 41, 42, 43],
    indices: [-1, 2, 1, 0, -1],
  });
});
it('maps wrapped global coordinates to their original source indices', () => {
  expect(regionGrid([0, 90, 180, 270], -90, 90, true)).toEqual({
    values: [270, 0, 90],
    indices: [3, 0, 1],
  });
  expect(regionGrid([0, 90, 180, 270], -180, 180, true).indices).toEqual([2, 3, 0, 1]);
});
it('handles dateline-crossing and fractional coordinate grids', () => {
  expect(regionGrid([179, 179.5, 180, 180.5], 179.5, -179, true)).toEqual({
    values: [179.5, 180, 180.5, -179],
    indices: [1, 2, 3, -1],
  });
  expect(regionGrid([0, 0.25, 0.5], 0.1, 0.6).values).toEqual([0.25, 0.5]);
});
it('retains source samples despite coordinate rounding and accumulated step error', () => {
  const source = Array.from(new Float32Array(Array.from({ length: 100 }, (_, i) => i * 0.1)));
  const result = regionGrid(source, 0, source.at(-1)!);
  expect(result.indices).toEqual(source.map((_, i) => i));
  expect(result.values).toEqual(source);
});
it('retains rounded descending and wrapped source coordinates', () => {
  const source = Array.from({ length: 100 }, (_, i) => 230 - i / 3);
  expect(regionGrid(source, -163, -130, true).indices).toEqual(
    source.map((_, i) => source.length - 1 - i),
  );
});
