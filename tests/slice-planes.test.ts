import { expect, it } from 'vitest';
import { OrbitViewport } from '@deck.gl/core';
import { cubeProjection } from '../src/render/cube-projection';
import { draggedSliceIndex, slicePlanes } from '../src/render/slice-planes';

it('snaps dragging to irregular time coordinates and clamps at either end', () => {
  const values = [0, 6, 24];
  expect(draggedSliceIndex(values, 0, 240, 0, 70, 0)).toBe(1);
  expect(draggedSliceIndex(values, 0, 240, 0, 200, 0)).toBe(2);
  expect(draggedSliceIndex(values, 0, 240, 0, -500, 0)).toBe(0);
  expect(draggedSliceIndex(values, 1, 240, 0, 500, 0)).toBe(2);
  expect(draggedSliceIndex(values, 0, 0, 0, 0, -180)).toBe(2);
});

it('keeps cut faces finite for singleton dimensions and hides back faces', () => {
  const viewport = new OrbitViewport({
    ...cubeProjection,
    width: 900,
    height: 600,
    rotationX: 27,
    rotationOrbit: -34,
  });
  const planes = slicePlanes([[0], [40, 42], [0, 6, 24]], [0, 0, 1], viewport);
  for (const plane of planes) expect(plane.corners).not.toMatch(/NaN|Infinity/);
  const reversed = new OrbitViewport({
    ...cubeProjection,
    width: 900,
    height: 600,
    rotationX: 27,
    rotationOrbit: 146,
  });
  const opposite = slicePlanes(
    [
      [0, 2],
      [40, 42],
      [0, 6, 24],
    ],
    [1, 0, 1],
    reversed,
  );
  expect(opposite[0].visible).toBe(false);
  expect(opposite[1].visible).toBe(false);
});
