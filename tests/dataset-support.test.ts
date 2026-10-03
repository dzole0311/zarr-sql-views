import { expect, it } from 'vitest';
import {
  assertGeographicCoordinates,
  defaultVariable,
  catalogSupport,
} from '../src/engine/dataset-support';
it('never treats rotated degrees as geographic longitude and latitude', () => {
  expect(() =>
    assertGeographicCoordinates(
      { units: 'degrees', standard_name: 'grid_longitude' },
      { units: 'degrees', standard_name: 'grid_latitude' },
    ),
  ).toThrow('rotated');
  expect(() => assertGeographicCoordinates({ units: 'm' }, { units: 'm' })).toThrow('projected');
  expect(() =>
    assertGeographicCoordinates({ units: 'degrees_east' }, { units: 'degrees_north' }),
  ).not.toThrow();
});
it('selects precipitation instead of an incidental quality or category variable', () => {
  expect(defaultVariable(['precipitation_quality_index_surface', 'precipitation_surface'])).toBe(
    'precipitation_surface',
  );
  expect(defaultVariable(['categorical_precipitation_type_surface', 'precipitation_surface'])).toBe(
    'precipitation_surface',
  );
  expect(defaultVariable(['precipitation_surface', 'temperature_2m'])).toBe('temperature_2m');
});
it('blocks known unsupported grid and virtual cloud formats', () => {
  expect(
    catalogSupport('https://catalog.example.test/eccc-hrdps-forecast/collection.json')?.disabled,
  ).toBe(true);
  expect(
    catalogSupport('https://catalog.example.test/noaa-gfs-analysis-virtual/collection.json')
      ?.disabled,
  ).toBe(true);
  expect(catalogSupport('https://example.com/noaa-gfs-analysis/collection.json')).toBeNull();
});
