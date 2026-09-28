import type { Extent } from '../engine/types';

/** Equirectangular world coordinates, split at the dateline. */
export function minimapRegions([west, south, east, north]: Extent) {
  const x = (((west + 180) % 360) + 360) % 360;
  const width = Math.abs(east - west) >= 360 ? 360 : (((east - west) % 360) + 360) % 360;
  const y = 90 - Math.min(90, north);
  const height = Math.max(0, Math.min(90, north) - Math.max(-90, south));
  if (width === 360) return [{ x: 0, y, width, height }];
  const first = { x, y, width: Math.min(width, 360 - x), height };

  return x + width > 360 ? [first, { x: 0, y, width: x + width - 360, height }] : [first];
}
