import { expect, it } from 'vitest';
import { valueRange, formatValue } from '../src/render/value-scale';
it('preserves precipitation magnitudes and distinct legend ticks', () => {
  const [min, max] = valueRange(0, 0.000173);
  expect(min).toBe(0);
  expect(max).toBeGreaterThanOrEqual(0.000173);
  expect(max).toBeLessThan(0.0002);
  expect(new Set([min, (min + max) / 2, max].map(formatValue)).size).toBe(3);
  expect(formatValue(0.000001)).not.toBe('0');
});
it('handles temperature, negative ranges, and constant fields', () => {
  expect(valueRange(-17.2, 42.4)).toEqual([-18, 43]);
  for (const [min, max] of [
    [0, 0],
    [0.00001, 0.00001],
    [-4, -4],
  ]) {
    const range = valueRange(min, max);
    expect(range[0]).toBeLessThan(range[1]);
    expect(range[0]).toBeLessThanOrEqual(min);
    expect(range[1]).toBeGreaterThanOrEqual(max);
  }
});
