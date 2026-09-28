import type { Volume } from '../engine/types';
import { pointForecast } from '../engine/coordinates';

export type ForecastPoint = { id: string; color: string; anchor: [number, number]; volume: Volume };

const colors = [
  '#5874b8',
  '#bb6b37',
  '#31877d',
  '#9765aa',
  '#b95772',
  '#85852e',
  '#377eaa',
  '#81644c',
];

export function addForecastPoint(points: ForecastPoint[], volume: Volume, x: number, y: number) {
  const anchor: [number, number] = [
    x / Math.max(1, volume.shape[2] - 1),
    y / Math.max(1, volume.shape[1] - 1),
  ];

  const id = `${anchor[0]}:${anchor[1]}`;
  if (points.some((p) => p.id === id)) return points;
  const color =
    colors.find((c) => !points.some((p) => p.color === c)) ||
    `hsl(${(points.length * 137.508) % 360} 45% 45%)`;

  return [...points, { id, color, anchor, volume: pointForecast(volume, x, y) }];
}

export function anchoredCell(point: ForecastPoint, volume: Volume) {
  return {
    x: Math.round(point.anchor[0] * (volume.shape[2] - 1)),
    y: Math.round(point.anchor[1] * (volume.shape[1] - 1)),
  };
}

/** Resample saved cube anchors after a region change while preserving IDs and colors. */
export function refreshForecastPoints(points: ForecastPoint[], volume: Volume) {
  return points.map((point) => {
    const { x, y } = anchoredCell(point, volume);

    return { ...point, volume: pointForecast(volume, x, y) };
  });
}
