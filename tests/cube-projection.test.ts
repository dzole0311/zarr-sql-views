import { expect, it } from 'vitest';
import { OrbitViewport } from '@deck.gl/core';
import { cubeProjection } from '../src/render/cube-projection';

const corners = [-175, 175].flatMap((x) =>
  [-175, 175].flatMap((y) => [-125, 125].map((z) => [x, y, z])),
);

it('keeps the full cube between the clipping planes while zoomed, orbited and panned', () => {
  for (const height of [200, 900])
    for (const zoom of [-2, 0, 3])
      for (const rotationX of [-90, 27, 90])
        for (const rotationOrbit of [-180, -34, 90])
          for (const target of [
            [0, 0, 0],
            [350, -350, 250],
          ]) {
            const viewport = new OrbitViewport({
              ...cubeProjection,
              width: 1000,
              height,
              zoom,
              rotationX,
              rotationOrbit,
              target: target as [number, number, number],
            });
            for (const point of corners) {
              const depth = viewport.project(point)[2];
              expect(depth).toBeGreaterThan(-1);
              expect(depth).toBeLessThan(1);
            }
          }
});

it('preserves screen scale and projection round trips', () => {
  const options = { width: 1000, height: 700, zoom: 3, rotationX: 27, rotationOrbit: -34 };
  const previous = new OrbitViewport({ ...options, orthographic: true });
  const viewport = new OrbitViewport({ ...options, ...cubeProjection });
  for (const point of corners) {
    const projected = viewport.project(point);
    const original = previous.project(point);
    expect(projected[0]).toBeCloseTo(original[0], 6);
    expect(projected[1]).toBeCloseTo(original[1], 6);
    viewport.unproject(projected).forEach((value, axis) => {
      expect(value).toBeCloseTo(point[axis], 6);
    });
  }
});
