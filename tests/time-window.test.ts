import { expect, it } from 'vitest';
import { timeWindow, windowTimeCoordinates } from '../src/engine/time-window';
import { coordinateDate, planChunks } from '../src/engine/coordinates';
it('reads only the last 66 coordinates of a long analysis archive', () => {
  expect(timeWindow(250000, false)).toEqual({ start: 249934, stop: 250000 });
  expect(timeWindow(61, true)).toEqual({ start: 0, stop: 61 });
  expect(timeWindow(12, false)).toEqual({ start: 0, stop: 12 });
});
it('retains absolute dates and source chunk indices after rebasing a window', () => {
  const t = windowTimeCoordinates(
    [200000, 200006, 200012],
    'hours since 1970-01-01',
    249939,
    false,
  );
  expect(t.values).toEqual([0, 6, 12]);
  expect(t.indices).toEqual([249939, 249940, 249941]);
  expect(coordinateDate(t.values[2], t.units)).toBe(
    coordinateDate(200012, 'hours since 1970-01-01'),
  );
  expect(planChunks([250000], [10], [t.indices])).toEqual([[24993], [24994]]);
});
it('preserves forecast lead times, including interval fields that start after zero', () => {
  expect(windowTimeCoordinates([6, 12, 18], 'hours', 0, true)).toEqual({
    values: [6, 12, 18],
    units: 'hours',
    indices: [0, 1, 2],
  });
});
