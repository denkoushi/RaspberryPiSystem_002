import type { LoanCardHtmlAppearance } from './loan-card-palette.js';

/**
 * feTurbulence による軽いノイズ（プレビュー HTML と同型）。Playwright/Chromium で data URI 背景として利用。
 */
const NOISE_SVG_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * カード背面の装飾レイヤ（ハイライトシーン + ノイズ）。`position:relative` なカード直下に置く。
 */
export function buildLoanCardHtmlSurfaceOverlays(appearance: LoanCardHtmlAppearance, cardRadiusPx: number): string {
  const r = cardRadiusPx;
  return `<div aria-hidden="true" style="position:absolute;inset:0;border-radius:${r}px;pointer-events:none;background:${appearance.sheenBackground};"></div><div aria-hidden="true" style="position:absolute;inset:0;border-radius:${r}px;pointer-events:none;opacity:${appearance.noiseOpacity};background-image:${NOISE_SVG_DATA_URI};"></div>`;
}
