export const palettes = {
  snowfall: [
    [140, 81, 10],
    [191, 129, 45],
    [223, 194, 125],
    [246, 232, 195],
    [255, 255, 255],
    [222, 235, 247],
    [158, 202, 225],
    [49, 130, 189],
    [8, 81, 156],
  ],
  thermal: [
    [48, 41, 112],
    [65, 91, 166],
    [54, 160, 172],
    [156, 205, 159],
    [243, 218, 125],
    [235, 140, 86],
    [172, 60, 66],
  ],
  ocean: [
    [19, 38, 75],
    [31, 90, 127],
    [48, 146, 166],
    [142, 207, 190],
    [234, 243, 207],
  ],
  ember: [
    [35, 26, 58],
    [91, 43, 100],
    [158, 65, 91],
    [216, 111, 79],
    [246, 177, 109],
    [251, 235, 182],
  ],
};

export type Palette = keyof typeof palettes;

export const paletteNames = Object.keys(palettes) as Palette[];

export const snowfallRange: [number, number] = [-100, 100];

export function color(
  value: number,
  min: number,
  max: number,
  palette: Palette = 'thermal',
): [number, number, number, number] {
  if (!Number.isFinite(value)) return [38, 43, 46, 255];

  const stops = palettes[palette],
    u = Math.max(0, Math.min(1, (value - min) / (max - min || 1))) * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(u)),
    f = u - i;

  return [...stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f)), 255] as [
    number,
    number,
    number,
    number,
  ];
}

export function colorSprite() {
  const data = new Uint8ClampedArray(256 * paletteNames.length * 4);
  paletteNames.forEach((p, row) => {
    for (let x = 0; x < 256; x++) data.set(color(x, 0, 255, p), (row * 256 + x) * 4);
  });

  return new ImageData(data, 256, paletteNames.length);
}

/** Build the CSS legend gradient from the same stops used by the volume renderer. */
export const gradient = (p: Palette) =>
  `linear-gradient(90deg, ${palettes[p].map((c) => `rgb(${c.join(',')})`).join(',')})`;
