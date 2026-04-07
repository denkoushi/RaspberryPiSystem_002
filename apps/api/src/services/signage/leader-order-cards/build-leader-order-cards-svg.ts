import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';
import { buildLeaderOrderResourceCardSvgFragment } from './leader-order-cards-svg-card.js';
import { buildLeaderOrderEmptyGridSlotSvg } from './leader-order-cards-svg-empty-slot.js';
import { computeLeaderOrderSignageSvgMetrics } from './leader-order-cards-svg-metrics.js';

/**
 * 順位ボード資源カードのサイネージ用 SVG（操作UIなし）。
 * 組み立てのみ担当 — 幾何・1カード描画・空スロットは別モジュール（単一責任）。
 */
export function buildLeaderOrderCardsSvg(cards: LeaderOrderCardViewModel[], width: number, height: number): string {
  const layout = computeLeaderOrderSignageSvgMetrics(width, height);
  const { gridSlots, slotCount, radius } = layout;

  const cardsSvg = gridSlots
    .slice(0, slotCount)
    .map((slot, slotIndex) => {
      const card = cards[slotIndex];
      if (!card) {
        return buildLeaderOrderEmptyGridSlotSvg(slot, radius);
      }
      return buildLeaderOrderResourceCardSvgFragment(card, slot, layout);
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="leaderBoardBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#leaderBoardBg)"/>
  ${cardsSvg}
</svg>`;
}
