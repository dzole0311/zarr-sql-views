import { expect, it } from 'vitest';
import { remapSlices } from '../src/render/slice-remap';
it('keeps a full cube full when returning from a narrow edge load', () => {
  expect(remapSlices([2, 0, 65], [66, 141, 3], [66, 141, 141])).toEqual([140, 0, 65]);
});
it('preserves intentional fractional cuts rather than clamping their old indices', () => {
  expect(remapSlices([5, 5, 30], [61, 11, 11], [61, 21, 21])).toEqual([10, 10, 30]);
});
it('expands fully visible singleton axes when returning to a larger region', () => {
  expect(remapSlices([0, 0, 0], [1, 1, 1], [5, 7, 9])).toEqual([8, 0, 4]);
});
