/** Create a compact forecast dot with light and dark rings for contrast on any palette.
 * The doubled SVG resolution keeps the marker crisp on high-density displays. */
export function pointMarkerIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 18 18">
    <circle cx="9" cy="9" r="7" fill="#fff" stroke="#303239" stroke-width="1.5"/>
    <circle cx="9" cy="9" r="4.5" fill="${color}"/>
  </svg>`;

  return {
    url: 'data:image/svg+xml,' + encodeURIComponent(svg),
    width: 36,
    height: 36,
    anchorX: 18,
    anchorY: 18,
  };
}
