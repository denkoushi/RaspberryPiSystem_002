import type { CompactCardHtmlTokens } from './grid-card-html-tokens.js';
import { escapeHtml } from './html-escape.js';
import type { LoanCardCompactKioskLines } from '../loan-card-grid.dto.js';

/**
 * Playwright compact カード中央ブロック（キオスク持出一覧と同じ行順）。
 */
export function buildCompactKioskMiddleHtml(
  kiosk: LoanCardCompactKioskLines,
  clientLocation: string,
  t: CompactCardHtmlTokens
): string {
  const head = escapeHtml(kiosk.headLine);
  const name = escapeHtml(kiosk.nameLine);
  const loc = escapeHtml(clientLocation);
  const idPx = Math.max(11, t.locationPx);
  const idPart =
    kiosk.idNumValue != null
      ? `<span style="flex-shrink:0;font-size:${idPx}px;font-weight:600;color:rgba(255,255,255,0.88);">${escapeHtml(
          kiosk.idNumValue
        )}</span>`
      : '';
  const namePx = Math.max(t.nameAndPrimaryPx, Math.round(t.nameAndPrimaryPx * 1.07));
  return `
    <div style="display:flex;flex-direction:row;align-items:baseline;gap:8px;min-width:0;margin-bottom:2px;flex-shrink:0;">
      <div style="font-weight:700;font-size:${t.nameAndPrimaryPx}px;line-height:1.2;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${head}</div>
      ${idPart}
    </div>
    <div style="font-weight:700;font-size:${namePx}px;line-height:1.2;flex:0 1 auto;min-height:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${name}</div>
    <div style="font-weight:600;font-size:${t.locationPx}px;color:#e2e8f0;line-height:1.2;flex:1 1 0;min-height:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;">${loc}</div>
  `;
}
