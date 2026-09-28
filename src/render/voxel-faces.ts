/** Only exposed faces are drawn. Shared faces cannot be seen in an opaque volume. */
export function voxelFaces(mask: Uint8Array, shape: number[], cuts: number[]): Float32Array {
  const [nt, ny, nx] = shape;
  const [cx, cy, ct] = cuts;
  const stride = nx * ny;

  const visit = (emit: (id: number, face: number) => void) => {
    for (let t = 0; t <= Math.min(ct, nt - 1); t++)
      for (let y = Math.max(0, cy); y < ny; y++)
        for (let x = 0; x <= Math.min(cx, nx - 1); x++) {
          const id = t * stride + y * nx + x;
          if (!mask[id]) continue;
          if (t === ct || t === nt - 1 || !mask[id + stride]) emit(id, 0);
          if (y === cy || !mask[id - nx]) emit(id, 1);
          if (x === cx || x === nx - 1 || !mask[id + 1]) emit(id, 2);
          if (t === 0 || !mask[id - stride]) emit(id, 3);
          if (y === ny - 1 || !mask[id + nx]) emit(id, 4);
          if (x === 0 || !mask[id - 1]) emit(id, 5);
        }
  };

  let count = 0;
  visit(() => count++);
  const faces = new Float32Array(count * 2);
  let offset = 0;

  visit((id, face) => {
    faces[offset++] = id;
    faces[offset++] = face;
  });

  return faces;
}

/** Static exposed surfaces plus one reusable cap per spatial cell.
 * Face 6 is positioned at the current time by the vertex shader. */
export function voxelTimelineFaces(
  mask: Uint8Array,
  shape: number[],
  cuts: number[],
): Float32Array {
  const [nt, ny, nx] = shape;
  const sides = voxelFaces(mask, shape, [cuts[0], cuts[1], nt - 1]);
  const width = Math.max(0, Math.min(cuts[0] + 1, nx));
  const south = Math.max(0, cuts[1]);
  const faces = new Float32Array(sides.length + width * Math.max(0, ny - south) * 2);
  faces.set(sides);
  let offset = sides.length;
  for (let y = south; y < ny; y++)
    for (let x = 0; x < width; x++) {
      faces[offset++] = y * nx + x;
      faces[offset++] = 6;
    }

  return faces;
}
