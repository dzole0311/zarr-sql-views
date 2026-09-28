/** Range rounding follows the data's magnitude, rather than assuming whole degrees. */
export function valueRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * 0.01;

    return min === 0 ? [0, padding] : [min - padding, max + padding];
  }

  const step = 10 ** (Math.floor(Math.log10(max - min)) - 1);

  return [
    Number((Math.floor(min / step) * step).toPrecision(12)),
    Number((Math.ceil(max / step) * step).toPrecision(12)),
  ];
}

export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return 'No data';
  if (value === 0) return '0';
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 100000) return value.toExponential(2);

  return String(Number(value.toPrecision(4)));
}
