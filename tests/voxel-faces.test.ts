import { expect, it } from 'vitest';
import { voxelFaces } from '../src/render/voxel-faces';
it('renders an isolated interior match with all six faces', () => {
  const mask = new Uint8Array(27);
  mask[13] = 255;
  const faces = voxelFaces(mask, [3, 3, 3], [2, 0, 2]);
  expect(Array.from(faces)).toEqual([13, 0, 13, 1, 13, 2, 13, 3, 13, 4, 13, 5]);
});
it('removes shared faces without removing neighboring cells', () => {
  const mask = new Uint8Array(27);
  mask[13] = 255;
  mask[14] = 255;
  const faces = Array.from(voxelFaces(mask, [3, 3, 3], [2, 0, 2]));
  expect(faces.length / 2).toBe(10);
  expect(faces.filter((_, i) => i % 2 === 0)).toContain(14);
});
it('retains only cells within all three cuts and closes the new boundary', () => {
  const mask = new Uint8Array(27).fill(255);
  const faces = voxelFaces(mask, [3, 3, 3], [1, 1, 1]);
  const ids = Array.from(faces).filter((_, i) => i % 2 === 0);
  expect(new Set(ids)).toEqual(new Set([3, 4, 6, 7, 12, 13, 15, 16]));
  expect(faces.length / 2).toBe(24);
});
it('handles empty results and a completely selected volume', () => {
  expect(voxelFaces(new Uint8Array(27), [3, 3, 3], [2, 0, 2])).toHaveLength(0);
  expect(voxelFaces(new Uint8Array(27).fill(255), [3, 3, 3], [2, 0, 2]).length / 2).toBe(54);
});

import { voxelTimelineFaces } from '../src/render/voxel-faces';
it('cached timeline geometry matches rebuilt surfaces at every time cut', () => {
  const shape = [5, 4, 6];
  const stride = shape[1] * shape[2];
  for (const mask of [
    new Uint8Array(120).fill(255),
    Uint8Array.from({ length: 120 }, (_, i) => (i % 3 === 0 || i % 7 === 0 ? 255 : 0)),
  ]) {
    for (const [cx, cy] of [
      [5, 0],
      [3, 1],
    ]) {
      const cached = voxelTimelineFaces(mask, shape, [cx, cy, 4]);
      for (let ct = 0; ct < 5; ct++) {
        const actual: string[] = [];
        for (let i = 0; i < cached.length; i += 2) {
          let id = cached[i],
            face = cached[i + 1];
          if (face === 6) {
            id += ct * stride;
            face = 0;
            if (!mask[id]) continue;
          } else if (Math.floor(id / stride) > ct || (face === 0 && Math.floor(id / stride) === ct))
            continue;
          actual.push(`${id}:${face}`);
        }
        const expected = voxelFaces(mask, shape, [cx, cy, ct]);
        const pairs = Array.from(
          { length: expected.length / 2 },
          (_, i) => `${expected[i * 2]}:${expected[i * 2 + 1]}`,
        );
        expect(actual.sort()).toEqual(pairs.sort());
      }
    }
  }
});
