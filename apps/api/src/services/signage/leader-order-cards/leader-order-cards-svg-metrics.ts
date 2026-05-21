import {
  computeKioskProgressOverviewGridSlots,
  type KioskProgressOverviewGridSlot,
} from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import {
  LEADER_ORDER_SIGNAGE_GRID_CAPACITY,
  LEADER_ORDER_SIGNAGE_GRID_COLUMNS,
  LEADER_ORDER_SIGNAGE_GRID_ROWS,
} from './layout-contracts.js';

/** 1920×1080 基準のスケール用 */
export const LEADER_ORDER_SIGNAGE_REFERENCE_WIDTH = 1920;

/**
 * 1回の JPEG 描画で使う幾何・タイポのまとまり（純関数で決定）。
 * グリッド計算は進捗一覧と同じ `computeKioskProgressOverviewGridSlots` を再利用（DRY）。
 */
export type LeaderOrderSignageSvgMetrics = {
  scale: number;
  cardPad: number;
  headerH: number;
  titleFs: number;
  subFs: number;
  bodyFs: number;
  smallFs: number;
  radius: number;
  rowGapInside: number;
  gridSlots: KioskProgressOverviewGridSlot[];
  /** `gridSlots` のうち実際に描画する枚数（容量上限でクリップ） */
  slotCount: number;
};

export function computeLeaderOrderSignageSvgMetrics(width: number, height: number): LeaderOrderSignageSvgMetrics {
  const scale = width / LEADER_ORDER_SIGNAGE_REFERENCE_WIDTH;
  const outerPad = Math.round(10 * scale);
  const colGap = Math.round(6 * scale);
  const rowGap = Math.round(6 * scale);

  const gridSlots = computeKioskProgressOverviewGridSlots({
    width,
    height,
    columns: LEADER_ORDER_SIGNAGE_GRID_COLUMNS,
    rows: LEADER_ORDER_SIGNAGE_GRID_ROWS,
    outerPad,
    colGap,
    rowGap,
  });

  const cardPad = Math.round(6 * scale);
  const titleFs = Math.max(18, Math.round(24 * scale));
  const subFs = Math.max(13, Math.round(16 * scale));
  const bodyFs = Math.max(14, Math.round(17 * scale));
  const smallFs = Math.max(11, Math.round(14 * scale));
  const headerH = Math.max(Math.round(36 * scale), cardPad * 2 + titleFs + Math.round(6 * scale));

  return {
    scale,
    cardPad,
    headerH,
    titleFs,
    subFs,
    bodyFs,
    smallFs,
    radius: Math.round(8 * scale),
    rowGapInside: Math.max(2, Math.round(4 * scale)),
    gridSlots,
    slotCount: Math.min(gridSlots.length, LEADER_ORDER_SIGNAGE_GRID_CAPACITY),
  };
}
