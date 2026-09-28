/** Interval fields can legitimately omit lead zero, before any interval exists. */
export function forecastStart(
  coverage: Uint32Array,
  times: number[],
  attrs: Record<string, unknown>,
): number {
  const stepType = String(attrs.step_type ?? attrs.GRIB_stepType ?? '').toLowerCase();

  const interval =
    ['avg', 'accum'].includes(stepType) ||
    /time:\s*(mean|sum)\b/i.test(String(attrs.cell_methods ?? '')) ||
    /since the previous forecast step/i.test(String(attrs.comment ?? ''));

  const start = interval && times[0] === 0 && coverage[0] === 0 ? 1 : 0;
  const missing = times.filter((_, i) => i >= start && coverage[i] === 0);
  if (missing.length)
    throw Error(
      `This initialization has missing source data at forecast coordinates ${missing.join(', ')}. Choose an earlier initialization.`,
    );

  return start;
}
