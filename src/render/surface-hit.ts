/** Test a screen point against a convex projected face, excluding edge-on projections. */
export function insideProjectedFace(x: number, y: number, corners: number[][]): boolean {
  let positive = false;
  let negative = false;
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    positive ||= cross > 0.01;
    negative ||= cross < -0.01;
    area += a[0] * b[1] - b[0] * a[1];
  }

  return Math.abs(area) > 1 && !(positive && negative);
}
