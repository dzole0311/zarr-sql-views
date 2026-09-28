import { expect, it } from 'vitest';
import { exampleOptions, snowfallExample } from '../src/engine/examples';
import { timeValue, timeLabel } from '../src/engine/time-labels';
import { timeWindow } from '../src/engine/time-window';
import { forecastViewSQL } from '../src/analysis/forecast-view';
it('opens direct snowfall links with their explicit array and winter axis', () => {
  expect(exampleOptions({ url: snowfallExample.url + '/' })).toMatchObject({
    variable: 'winter_anomaly',
    axes: { t: 'winter' },
  });
  expect(exampleOptions({ url: snowfallExample.url, variable: 'jfm_snowfall' }).variable).toBe(
    'jfm_snowfall',
  );
  expect(exampleOptions({ url: 'https://example.org/data' })).toEqual({
    url: 'https://example.org/data',
  });
  expect(exampleOptions({ url: snowfallExample.url, variable: 'event_anomaly' }).axes?.t).toBe(
    'year',
  );
  expect(snowfallExample.variables).toHaveLength(6);
  expect(timeWindow(66, false)).toEqual({ start: 0, stop: 66 });
});
it('retains calendar years in labels and SQL without pretending they are durations', () => {
  expect(timeValue(2024, 'winter year')).toBe(2024);
  expect(timeLabel(2024, 'winter year')).toBe('Winter 2024');
  expect(timeValue(7200, 'seconds')).toBe(2);
  const query = forecastViewSQL({
    shape: [2, 1, 1],
    lon: [-100],
    lat: [40],
    times: [2023, 2024],
    timeUnits: 'winter year',
    variable: 'winter_anomaly',
  });
  expect(query).toContain('NULL::DOUBLE AS forecast_hour');
  expect(query).toContain('[2023,2024]::DOUBLE[]');
  expect(query).toContain('AS winter');
});
