import { validateExtent, wrapLongitude } from './coordinates';
import type { Extent } from './types';

/** Center a square longitude/latitude footprint inside the requested geographic bounds.
 * Cropping the longer axis keeps the selection inside its existing data and memory budgets.
 * Dateline-crossing regions retain their eastward longitude span. */
export function squareExtent(extent: Extent): Extent {
  validateExtent(extent);
  const [west, south, east, north] = extent;
  const width = Math.abs(east - west) >= 360 ? 360 : (((east - west) % 360) + 360) % 360;
  const height = north - south;
  if (width === 0) throw Error('Choose a region with a nonzero longitude span.');
  if (Math.abs(width - height) < 1e-9) return extent;
  const span = Math.min(width, height);
  const left = west + (width - span) / 2;
  const bottom = south + (height - span) / 2;

  return [wrapLongitude(left), bottom, wrapLongitude(left + span), bottom + span];
}
