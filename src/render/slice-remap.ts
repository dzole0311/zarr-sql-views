/** Preserve the position of cuts when a regional load changes its sample count. */
export function remapSlices(
  cuts: [number, number, number],
  oldShape: [number, number, number],
  newShape: [number, number, number],
): [number, number, number] {
  const oldCounts = [oldShape[2], oldShape[1], oldShape[0]];
  const newCounts = [newShape[2], newShape[1], newShape[0]];

  return cuts.map((cut, axis) =>
    oldCounts[axis] === 1
      ? axis === 1
        ? 0
        : newCounts[axis] - 1
      : Math.round(
          Math.max(0, Math.min(1, cut / Math.max(1, oldCounts[axis] - 1))) * (newCounts[axis] - 1),
        ),
  ) as [number, number, number];
}
