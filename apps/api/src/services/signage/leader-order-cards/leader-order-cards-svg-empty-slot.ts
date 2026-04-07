import type { KioskProgressOverviewGridSlot } from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import {
  LEADER_ORDER_SVG_EMPTY_SLOT_FILL,
  LEADER_ORDER_SVG_EMPTY_SLOT_STROKE,
} from './leader-order-cards-svg-theme.js';

/**
 * 資源がページ枚数未満のときの空きグリッドセル（意図的な「未使用」表示）。
 */
export function buildLeaderOrderEmptyGridSlotSvg(slot: KioskProgressOverviewGridSlot, radius: number): string {
  const { x0, y0, cardW, cardH } = slot;
  return `<g>
  <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" fill="${LEADER_ORDER_SVG_EMPTY_SLOT_FILL}" stroke="${LEADER_ORDER_SVG_EMPTY_SLOT_STROKE}" stroke-width="1" stroke-dasharray="7 5"/>
</g>`;
}
