import { RECENT_TIME_SAMPLES } from './load-budget';
import { coordinateDate } from './coordinates';

/** Analysis archives are previews of recent samples, not an entire history load. */
export function timeWindow(length: number, forecast: boolean) {
  const start = forecast ? 0 : Math.max(0, length - RECENT_TIME_SAMPLES);

  return { start, stop: length };
}

/** Rebase archive times to their first retained timestamp while preserving source indices. */
export function windowTimeCoordinates(
  values: number[],
  units: string,
  start: number,
  forecast: boolean,
) {
  const indices = values.map((_, i) => start + i);
  if (forecast || !units.includes('since ') || !values.length) return { values, units, indices };

  const origin = coordinateDate(values[0], units);

  return {
    values: values.map((v) => v - values[0]),
    units: `${units.split(' since ')[0]} since ${origin}`,
    indices,
  };
}
