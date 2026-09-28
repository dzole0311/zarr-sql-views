import { expect, it } from 'vitest';
import { squareExtent } from '../src/engine/square-extent';
import { minimapRegions } from '../src/render/minimap';

it('crops the screenshot region around its center to a square minimap footprint', () => {
  const extent = squareExtent([-11.25, 28.25, 58.5, 66]);
  expect(extent).toEqual([4.75, 28.25, 42.5, 66]);
  const [rect] = minimapRegions(extent);
  expect(rect.width).toBe(rect.height);
  expect(squareExtent(extent)).toBe(extent);
});

it('crops tall regions without moving their center or expanding the requested bounds', () => {
  expect(squareExtent([0, 20, 10, 60])).toEqual([0, 35, 10, 45]);
});

it('preserves square proportions across the dateline', () => {
  const extent = squareExtent([170, -5, -170, 5]);
  expect(extent).toEqual([175, -5, -175, 5]);
  const rects = minimapRegions(extent);
  expect(rects.reduce((sum, rect) => sum + rect.width, 0)).toBe(rects[0].height);
});

it('handles world bounds and rejects empty longitude spans', () => {
  expect(squareExtent([-180, -90, 180, 90])).toEqual([-90, -90, 90, 90]);
  expect(() => squareExtent([0, 20, 0, 30])).toThrow('nonzero');
});
