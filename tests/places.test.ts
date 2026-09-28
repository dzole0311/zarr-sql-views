import { describe, expect, it } from 'vitest';
import { placesInRegion, type Place } from '../src/render/places';
const place = (name: string, lon: number, lat: number, rank = 1): Place => ({
  name,
  lon,
  lat,
  rank,
  population: 1000,
});
describe('place labels', () => {
  it('unwraps places across the dateline and excludes places outside the surface', () => {
    const labels = placesInRegion(
      [
        place('East', 175, 0),
        place('West', -175, 0),
        place('Outside', -150, 0),
        place('North', 178, 20),
      ],
      [170, -10, 190, 10],
    );
    expect(labels.map(({ name, lon }) => [name, lon])).toEqual([
      ['East', 175],
      ['West', 185],
    ]);
  });
  it('bounds candidate count and prioritizes major places without mutating source coordinates', () => {
    const cities = Array.from({ length: 250 }, (_, i) => place(String(i), 0, 0, i));
    const labels = placesInRegion(cities, [-10, -10, 10, 10]);
    expect(labels).toHaveLength(200);
    expect(labels[0].name).toBe('0');
    expect(cities[0].lon).toBe(0);
  });
});

import { spacedPlaceLabels } from '../src/render/places';
it('keeps full label boxes apart, with priority given to earlier major cities', () => {
  const cities = [
    { name: 'London', x: 100, y: 100 },
    { name: 'Nearby city', x: 140, y: 110 },
    { name: 'Paris', x: 200, y: 160 },
  ];
  expect(
    spacedPlaceLabels(cities, (p) => [p.x, p.y], { width: 800, height: 600 }, 0).map((p) => p.name),
  ).toEqual(['London', 'Paris']);
});
it('limits the overview and reveals more places when zoomed in', () => {
  const cities = Array.from({ length: 40 }, (_, i) => ({
    name: 'City',
    x: 100 + (i % 8) * 160,
    y: 60 + Math.floor(i / 8) * 80,
  }));
  const screen = { width: 1600, height: 900 };
  expect(spacedPlaceLabels(cities, (p) => [p.x, p.y], screen, 0)).toHaveLength(10);
  expect(spacedPlaceLabels(cities, (p) => [p.x, p.y], screen, 1)).toHaveLength(20);
});
