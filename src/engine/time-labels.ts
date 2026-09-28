import { unitSeconds } from './coordinates';

/** Calendar years are labels, not durations that can be converted to forecast hours. */
export const isWinterTime = (units: string) => units === 'winter year';

export const timeValue = (value: number, units: string) =>
  isWinterTime(units) ? value : (value * unitSeconds(units)) / 3600;

export const timeLabel = (value: number, units: string) =>
  isWinterTime(units) ? `Winter ${value}` : `+${timeValue(value, units)} h`;
