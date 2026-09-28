import { expect, it } from 'vitest';
import { pointInVolume, pointForecast } from '../src/engine/coordinates';
import type { Volume } from '../src/engine/types';
const volume = {
  data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
  shape: [2, 2, 2],
  lon: [10, 11],
  lat: [40, 41],
  times: [0, 6],
  timeUnits: 'hours',
} as Volume;
it('retains a point series independently of the regional array', () => {
  const saved = pointForecast(volume, 1, 0);
  expect(Array.from(saved.data)).toEqual([2, 6]);
  expect(saved.shape).toEqual([2, 1, 1]);
  expect(saved.lon).toEqual([11]);
  expect(saved.lat).toEqual([40]);
  expect(saved.data.buffer).not.toBe(volume.data.buffer);
});
it('hides an out-of-region point and restores the same location at its new indexes', () => {
  expect(pointInVolume(volume, 11, 40)).toEqual({ x: 1, y: 0 });
  expect(pointInVolume({ ...volume, lon: [20, 21] }, 11, 40)).toBeNull();
  expect(pointInVolume({ ...volume, lon: [11, 12] }, 11, 40)).toEqual({ x: 0, y: 0 });
});
it('matches equivalent longitude conventions at the dateline', () => {
  expect(pointInVolume({ ...volume, lon: [180, 181] }, -179, 40)).toEqual({ x: 1, y: 0 });
});

import { addForecastPoint } from '../src/analysis/points';
it('adds distinct colors and does not duplicate the same geographic point', () => {
  const first = addForecastPoint([], volume, 0, 0);
  const second = addForecastPoint(first, volume, 1, 0);
  expect(second).toHaveLength(2);
  expect(second[0].color).not.toBe(second[1].color);
  expect(addForecastPoint(second, volume, 0, 0)).toBe(second);
  expect(second[0]).toBe(first[0]);
  const remaining = second.slice(1);
  const third = addForecastPoint(remaining, volume, 0, 1);
  expect(third[0].color).toBe(second[1].color);
  expect(third[1].color).not.toBe(third[0].color);
});

import { anchoredCell, refreshForecastPoints } from '../src/analysis/points';
it('keeps cube anchors and colors while sampling the new geography after a pan', () => {
  const selected = addForecastPoint([], volume, 1, 0);
  const moved = {
    ...volume,
    lon: [20, 21],
    data: new Float32Array([11, 12, 13, 14, 15, 16, 17, 18]),
  };
  const refreshed = refreshForecastPoints(selected, moved);
  expect(refreshed[0].anchor).toEqual(selected[0].anchor);
  expect(refreshed[0].id).toBe(selected[0].id);
  expect(refreshed[0].color).toBe(selected[0].color);
  expect(refreshed[0].volume.lon).toEqual([21]);
  expect(Array.from(refreshed[0].volume.data)).toEqual([12, 16]);
  expect(anchoredCell(refreshed[0], { ...volume, shape: [2, 3, 4] })).toEqual({ x: 3, y: 0 });
  expect(addForecastPoint(refreshed, moved, 1, 0)).toBe(refreshed);
});

it('preserves Float64 source values in saved point forecasts', () => {
  const precise = 1 + 2 ** -40;
  const saved = pointForecast(
    { ...volume, data: new Float64Array([precise, 2, 3, 4, precise, 6, 7, 8]) },
    0,
    0,
  );
  expect(saved.data).toBeInstanceOf(Float64Array);
  expect(saved.data[0]).toBe(precise);
  expect(saved.data[1]).toBe(precise);
});
