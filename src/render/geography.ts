export type XY = [number, number];

export type Segment = { source: XY; target: XY };

export type Bounds = [number, number, number, number];

type Geometry = { type: string; coordinates: unknown };

/** Flatten geographic lines and polygon rings into segments unwrapped across the dateline. */
export function boundarySegments(geometry: Geometry): Segment[] {
  const coordinates = geometry.coordinates;

  const lines: number[][][] =
    geometry.type === 'LineString'
      ? [coordinates as number[][]]
      : geometry.type === 'MultiLineString' || geometry.type === 'Polygon'
        ? (coordinates as number[][][])
        : geometry.type === 'MultiPolygon'
          ? (coordinates as number[][][][]).flat()
          : [];

  const segments: Segment[] = [];
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const [x, y] = line[i - 1];
      let [endX, endY] = line[i];
      while (endX - x > 180) endX -= 360;
      while (endX - x < -180) endX += 360;
      segments.push({ source: [x, y], target: [endX, endY] });
    }

  return segments;
}

let boundaries: Promise<Segment[]> | undefined;

/** Share one boundary fetch across consumers; failed requests remain retryable. */
export function loadBoundaries() {
  return (boundaries ??= Promise.all(
    ['/countries.geojson', '/admin1-lines.geojson'].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error('Geographic boundaries could not be loaded. Please reload the view.');
      const data = (await response.json()) as { features: { geometry: Geometry }[] };

      return data.features.flatMap((feature) => boundarySegments(feature.geometry));
    }),
  )
    .then((layers) => layers.flat())
    .catch((error) => {
      boundaries = undefined;
      throw error;
    }));
}

/** Liang-Barsky clipping preserves exact intersections with the cube's cuts. */
export function clipSegment(segment: Segment, bounds: Bounds): Segment | null {
  const [x, y] = segment.source;
  const dx = segment.target[0] - x,
    dy = segment.target[1] - y;
  const p = [-dx, dx, -dy, dy];
  const q = [x - bounds[0], bounds[2] - x, y - bounds[1], bounds[3] - y];
  let enter = 0,
    exit = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }

    const t = q[i] / p[i];
    if (p[i] < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }

  return { source: [x + enter * dx, y + enter * dy], target: [x + exit * dx, y + exit * dy] };
}
