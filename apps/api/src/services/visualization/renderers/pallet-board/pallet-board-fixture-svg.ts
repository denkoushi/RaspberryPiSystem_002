/**
 * Inline SVG graphics for pallet "fixture" thumbnails in JPEG renders.
 * Keeps raster embedding out of the renderer; no external URLs.
 */
export function palletBoardFixtureInnerSvg(): string {
  return `
  <g fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="2.5">
    <rect x="10" y="16" width="80" height="108" rx="8" />
    <line x1="22" y1="34" x2="78" y2="34" />
    <circle cx="50" cy="72" r="16" />
    <path d="M30 98 L50 88 L70 98" stroke-linecap="round" stroke-linejoin="round" />
  </g>`;
}
