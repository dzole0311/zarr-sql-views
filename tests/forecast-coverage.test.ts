import { expect, it } from 'vitest';
import { forecastStart } from '../src/engine/forecast-coverage';

it('omits undefined lead zero for interval precipitation without shifting its lead times', () => {
  const times = [0, 6, 12];
  const start = forecastStart(new Uint32Array([0, 4, 4]), times, { step_type: 'avg' });
  expect(times.slice(start)).toEqual([6, 12]);
  const values = new Float32Array([NaN, NaN, NaN, NaN, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(Array.from(values.slice(start * 4))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});
it('retains actual zero-step data and partial spatial coverage', () => {
  expect(forecastStart(new Uint32Array([1, 4, 4]), [0, 6, 12], { step_type: 'avg' })).toBe(0);
});
it('does not hide missing instantaneous data', () => {
  expect(() => forecastStart(new Uint32Array([0, 4]), [0, 6], {})).toThrow('missing source data');
});
it('rejects missing later intervals and missing nonzero starting times', () => {
  expect(() => forecastStart(new Uint32Array([0, 4, 0]), [0, 6, 12], { step_type: 'avg' })).toThrow(
    '12',
  );
  expect(() => forecastStart(new Uint32Array([0, 4]), [6, 12], { step_type: 'accum' })).toThrow(
    '6',
  );
});
it('recognizes CF interval metadata', () => {
  expect(forecastStart(new Uint32Array([0, 4]), [0, 6], { cell_methods: 'time: mean' })).toBe(1);
});
