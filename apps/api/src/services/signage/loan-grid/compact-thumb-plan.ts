import type { LoanCardViewModel } from './loan-card-grid.dto.js';

/**
 * Compact24 カード左列の方針（工具は従来どおり空サムネ枠を維持）。
 */
export type CompactThumbPlan =
  | { kind: 'image'; dataUrl: string }
  | { kind: 'itemEmptySlot' }
  | { kind: 'hidden' };

/**
 * サムネ URL が解決して埋め込み画像がある → 画像。
 * キオスク準拠行がある（計測・吊具）かつ画像なし → 列ごと非表示（スペース確保に使わない）。
 * 上記以外（工具等）かつ画像なし → 従来の空 96px スロット。
 */
export function resolveCompactThumbPlan(view: LoanCardViewModel): CompactThumbPlan {
  if (view.thumbnailDataUrl) {
    return { kind: 'image', dataUrl: view.thumbnailDataUrl };
  }
  if (view.compactKioskLines) {
    return { kind: 'hidden' };
  }
  return { kind: 'itemEmptySlot' };
}

/** SVG `computeSplitCompact24Layout` の hasThumbnail と一致させる */
export function compactLayoutHasThumbnail(plan: CompactThumbPlan): boolean {
  return plan.kind === 'image';
}
