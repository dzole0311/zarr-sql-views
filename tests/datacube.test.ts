import { expect, it } from 'vitest';
import { readDatacube, resolveAxes, variableDetails } from '../src/engine/datacube';
const cube = readDatacube(
  {
    'cube:dimensions': {
      east: { type: 'spatial', axis: 'x' },
      north: { type: 'spatial', axis: 'y' },
      date: { type: 'temporal' },
    },
    'cube:variables': {
      snow: {
        type: 'data',
        dimensions: ['east', 'north', 'date'],
        unit: 'mm',
        description: 'Snowfall',
      },
    },
  },
  {},
);
it('maps unfamiliar names through STAC without assuming declaration order is storage order', () => {
  expect(resolveAxes(['date', 'north', 'east'], cube, 'snow')).toEqual({
    x: 'east',
    y: 'north',
    t: 'date',
  });
});
it('handles Dynamical initialization plus an additional lead-time dimension', () => {
  const forecast = readDatacube(
    {
      'cube:dimensions': {
        ...cube.dimensions,
        init_time: { type: 'temporal' },
        lead_time: { type: 'other' },
      },
    },
    {},
  );
  expect(resolveAxes(['init_time', 'lead_time', 'north', 'east'], forecast, 'temperature')).toEqual(
    { x: 'east', y: 'north', t: 'lead_time', init: 'init_time' },
  );
});
it('keeps direct Zarr inference and explicit mappings', () => {
  const empty = readDatacube({}, {});
  expect(resolveAxes(['time', 'lat', 'lon'], empty, 'v')).toEqual({
    x: 'lon',
    y: 'lat',
    t: 'time',
  });
  const axes = { x: 'a', y: 'b', t: 'c' };
  expect(resolveAxes(['c', 'b', 'a'], empty, 'v', axes)).toEqual(axes);
  expect(() => resolveAxes(['c', 'b', 'a'], empty, 'v', { x: 'a', y: 'a', t: 'c' })).toThrow(
    'exactly once',
  );
});
it('rejects inconsistent declarations and ambiguous temporal axes', () => {
  expect(() => resolveAxes(['time', 'north', 'east'], cube, 'snow')).toThrow('do not match');
  expect(() =>
    resolveAxes(
      ['date', 'other_date', 'north', 'east'],
      { ...cube, dimensions: { ...cube.dimensions, other_date: { type: 'temporal' } } },
      'v',
    ),
  ).toThrow('Ambiguous temporal');
  expect(() => resolveAxes(undefined, cube, 'snow')).toThrow('Zarr dimension names');
});
it('rejects projected STAC metadata even with explicit axis mapping', () => {
  const projected = {
    ...cube,
    dimensions: {
      ...cube.dimensions,
      east: { type: 'spatial', axis: 'x', reference_system: 3857 },
    },
  };
  expect(() =>
    resolveAxes(['date', 'north', 'east'], projected, 'snow', { x: 'east', y: 'north', t: 'date' }),
  ).toThrow('reference system');
});
it('uses asset metadata and rejects malformed maps', () => {
  expect(
    readDatacube({ 'cube:dimensions': cube.dimensions }, { 'cube:dimensions': {} }).dimensions,
  ).toEqual({});
  expect(() => readDatacube({ 'cube:dimensions': { bad: null } }, {})).toThrow('Invalid STAC');
});
it('uses STAC labels and units as fallback without relabeling stored Zarr values', () => {
  expect(variableDetails(cube, 'snow', {})).toEqual({ label: 'Snowfall', units: 'mm' });
  expect(variableDetails(cube, 'snow', { long_name: 'Snow', units: 'm' })).toEqual({
    label: 'Snow',
    units: 'm',
  });
});
