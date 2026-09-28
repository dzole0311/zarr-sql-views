import type { Bounds } from './geography';

export type Place = { name: string; lon: number; lat: number; rank: number; population: number };

let cached: Promise<Place[]> | undefined;

/** Share the bundled place-name fetch across views; failed requests remain retryable. */
export function loadPlaces(): Promise<Place[]> {
  return (cached ??= fetch('/places.json')
    .then((response) => {
      if (!response.ok) throw new Error('Unable to load place names');

      return response.json() as Promise<Place[]>;
    })
    .catch((error) => {
      cached = undefined;
      throw error;
    }));
}

/** Select up to 200 ranked places, unwrapping longitudes into the displayed bounds. */
export function placesInRegion(places: Place[], [west, south, east, north]: Bounds): Place[] {
  return places
    .map((place) => ({
      ...place,
      lon: west + ((((place.lon - west) % 360) + 360) % 360),
    }))
    .filter((place) => place.lon <= east && place.lat >= south && place.lat <= north)
    .sort((a, b) => a.rank - b.rank || b.population - a.population || a.name.localeCompare(b.name))
    .slice(0, 200);
}

/** Keep a quiet overview; add detail only when the camera moves closer. */
export function spacedPlaceLabels<T extends { name: string }>(
  candidates: T[],
  project: (place: T) => number[],
  viewport: { width: number; height: number },
  zoomFromFit: number,
): T[] {
  const limit = Math.min(32, Math.max(5, Math.round(10 * 2 ** Math.max(-1, zoomFromFit))));
  const boxes: { x: number; y: number; halfWidth: number }[] = [];
  const selected: T[] = [];
  for (const place of candidates) {
    const [x, y] = project(place);

    const halfWidth = place.name.length * 3.8 + 18;
    if (x - halfWidth < 0 || x + halfWidth > viewport.width || y < 20 || y > viewport.height - 20)
      continue;
    if (boxes.some((b) => Math.abs(x - b.x) < halfWidth + b.halfWidth && Math.abs(y - b.y) < 36))
      continue;
    selected.push(place);
    boxes.push({ x, y, halfWidth });
    if (selected.length >= limit) break;
  }

  return selected;
}
