import type { OrbitViewport } from '@deck.gl/core';
import { CUBE_SIZE, normalized } from './volume-layer';

export type SliceCuts = [number, number, number];

/** Project the three cut faces with the same camera as the volume. */
export function slicePlanes(coordinates: number[][], slices: SliceCuts, projection: OrbitViewport) {
  const low = [0, normalized(coordinates[1], slices[1]), 0];
  const high = [normalized(coordinates[0], slices[0]), 1, normalized(coordinates[2], slices[2])];
  const project = (point: number[]) =>
    projection.project(point.map((n, i) => (n - 0.5) * CUBE_SIZE[i]));
  return coordinates.map((values, axis) => {
    const fraction = normalized(values, slices[axis]);
    const center = low.map((n, i) => (n + high[i]) / 2);
    center[axis] = fraction;
    const other = [0, 1, 2].filter((n) => n !== axis);
    const projectedCorners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map((pair) => {
      const point = [...center];
      other.forEach((a, i) => (point[a] = pair[i] ? high[a] : low[a]));
      return project(point).slice(0, 2);
    });
    const corners = projectedCorners.map((p) => p.join(',')).join(' ');
    const start = [...center],
      end = [...center];
    start[axis] = 0;
    end[axis] = 1;
    const a = project(start),
      b = project(end);
    const outward = [...center];
    outward[axis] += axis === 1 ? -0.01 : 0.01;
    const visible = project(outward)[2] < project(center)[2];
    return { corners, fraction, visible, dx: b[0] - a[0], dy: b[1] - a[1] };
  });
}

/** Snap to source coordinates, including irregular time intervals. */
export function draggedSliceIndex(
  values: number[],
  fraction: number,
  dx: number,
  dy: number,
  movementX: number,
  movementY: number,
) {
  let length = dx * dx + dy * dy;
  // When the normal points at the camera, use vertical dragging.
  if (length < 4) {
    dx = 0;
    dy = -180;
    length = 32400;
  }
  const target = Math.max(0, Math.min(1, fraction + (movementX * dx + movementY * dy) / length));
  let nearest = 0;
  for (let i = 1; i < values.length; i++)
    if (Math.abs(normalized(values, i) - target) < Math.abs(normalized(values, nearest) - target))
      nearest = i;
  return nearest;
}
