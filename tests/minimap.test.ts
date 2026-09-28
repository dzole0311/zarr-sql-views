import { expect, it } from 'vitest';
import { minimapRegions } from '../src/render/minimap';
it('places Europe on the world overview', () => {
  expect(minimapRegions([-25, 34, 45, 72])).toEqual([{ x: 155, y: 18, width: 70, height: 38 }]);
});
it('splits dateline regions without shading the rest of the world', () => {
  expect(minimapRegions([170, -10, -170, 10])).toEqual([
    { x: 350, y: 80, width: 10, height: 20 },
    { x: 0, y: 80, width: 10, height: 20 },
  ]);
  expect(minimapRegions([170, -10, 190, 10])).toEqual(minimapRegions([170, -10, -170, 10]));
});
it('handles full world extents', () => {
  expect(minimapRegions([-180, -90, 180, 90])).toEqual([{ x: 0, y: 0, width: 360, height: 180 }]);
});
