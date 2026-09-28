import { expect, it } from 'vitest';
import { draggedRegion } from '../src/render/region-drag';
it('moves geography opposite the drag without changing the region size', () => {
  expect(draggedRegion([0, 30, 40, 70], 50, 0, [200, 0], [0, -200], [-90, 90])).toEqual([
    -10, 30, 30, 70,
  ]);
});
it('accounts for rotated screen axes', () => {
  expect(draggedRegion([0, 30, 40, 70], 50, 50, [100, 100], [100, -100], [-90, 90])).toEqual([
    -20, 30, 20, 70,
  ]);
});
it('clamps latitude without shrinking the region', () => {
  expect(draggedRegion([0, 30, 40, 70], 0, 300, [200, 0], [0, -200], [-90, 90])).toEqual([
    0, 50, 40, 90,
  ]);
});
it('wraps a region across the antimeridian', () => {
  expect(draggedRegion([150, 0, -170, 40], -100, 0, [200, 0], [0, -200], [-90, 90])).toEqual([
    170, 0, -150, 40,
  ]);
});
it('ignores an edge-on plane instead of requesting extreme bounds', () => {
  expect(draggedRegion([0, 30, 40, 70], 50, 50, [200, 0], [100, 0], [-90, 90])).toBeNull();
});
it('keeps a full-world longitude window valid', () => {
  expect(draggedRegion([-180, -20, 180, 20], 50, 0, [200, 0], [0, -200], [-90, 90])).toEqual([
    -180, -20, 180, 20,
  ]);
});
