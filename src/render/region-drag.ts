import type { Extent } from '../engine/types';

/** Convert a screen drag through the projected geographic plane, keeping its span fixed. */
export function draggedRegion(
  extent: Extent,
  dx: number,
  dy: number,
  xAxis: number[],
  yAxis: number[],
  latitudeBounds: [number, number],
): Extent | null {
  const det = xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0];
  if (Math.abs(det) < 1) return null;
  const x = (dx * yAxis[1] - dy * yAxis[0]) / det;
  const y = (dy * xAxis[0] - dx * xAxis[1]) / det;
  const width = (extent[2] - extent[0] + 360) % 360 || 360;
  const height = extent[3] - extent[1];
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
  const west = width === 360 ? -180 : wrap(extent[0] - x * width);

  const south = Math.max(
    latitudeBounds[0],
    Math.min(latitudeBounds[1] - height, extent[1] - y * height),
  );

  return [west, south, width === 360 ? 180 : wrap(west + width), south + height].map((n) =>
    Number(n.toFixed(4)),
  ) as Extent;
}
