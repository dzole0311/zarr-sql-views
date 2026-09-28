import { expect, it } from 'vitest';
import { clipSegment } from '../src/render/geography';
it('clips a border at both geographic cut faces', () => {
  expect(clipSegment({ source: [-10, 20], target: [50, 80] }, [0, 30, 40, 70])).toEqual({
    source: [0, 30],
    target: [40, 70],
  });
});
it('removes segments completely outside the retained region', () => {
  expect(clipSegment({ source: [45, 40], target: [45, 60] }, [0, 30, 40, 70])).toBeNull();
});
it('keeps borders on a cut edge, including reversed direction', () => {
  expect(clipSegment({ source: [40, 80], target: [40, 20] }, [0, 30, 40, 70])).toEqual({
    source: [40, 70],
    target: [40, 30],
  });
});

import { boundarySegments } from '../src/render/geography';
it('reads state/province line geometry and wraps dateline crossings', () => {
  expect(
    boundarySegments({
      type: 'LineString',
      coordinates: [
        [179, 40],
        [-179, 41],
      ],
    }),
  ).toEqual([{ source: [179, 40], target: [181, 41] }]);
  expect(
    boundarySegments({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
        ],
      ],
    }),
  ).toHaveLength(2);
});
