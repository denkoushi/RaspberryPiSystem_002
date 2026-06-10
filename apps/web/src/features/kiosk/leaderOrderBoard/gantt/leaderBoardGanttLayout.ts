import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MAX_ROW_HEIGHT_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_PX_PER_MINUTE,
  GANTT_ROW_VERTICAL_PADDING_PX
} from './leaderBoardGanttConstants';

export type LeaderBoardGanttRowLayout = {
  rowMinHeightPx: number;
  estimateHeightPx: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 視覚補正後スケールでの行コンテンツ高さ（min-height 用）。
 */
export function computeGanttRowContentHeightPx(requiredMinutes: number): number {
  const minutes = parseLeaderBoardRequiredMinutes(requiredMinutes);
  const rawHeightPx = minutes * GANTT_PX_PER_MINUTE;
  return clamp(rawHeightPx, GANTT_MIN_ROW_HEIGHT_PX, GANTT_MAX_ROW_HEIGHT_PX);
}

export function computeGanttRowLayout(params: {
  requiredMinutes: number;
  hasFooterChips?: boolean;
}): LeaderBoardGanttRowLayout {
  const contentHeightPx = computeGanttRowContentHeightPx(params.requiredMinutes);
  const estimateHeightPx =
    contentHeightPx +
    GANTT_ROW_VERTICAL_PADDING_PX +
    (params.hasFooterChips ? GANTT_FOOTER_CHIPS_EXTRA_PX : 0);
  return {
    rowMinHeightPx: contentHeightPx,
    estimateHeightPx
  };
}

/**
 * 8H 目盛の Y 位置（px）。`totalHeightPx` まで 8H 刻み（均一スケール用）。
 */
export function computeGanttEightHourTickPositions(totalHeightPx: number): number[] {
  const tickSpanPx = GANTT_EIGHT_HOURS_MINUTES * GANTT_PX_PER_MINUTE;
  if (!Number.isFinite(totalHeightPx) || totalHeightPx <= 0 || tickSpanPx <= 0) {
    return [0];
  }
  const positions: number[] = [];
  for (let y = 0; y < totalHeightPx; y += tickSpanPx) {
    positions.push(y);
  }
  return positions;
}

function mapGanttTimeYToVisualY(
  rowLayouts: readonly LeaderBoardGanttRowLayout[],
  timeY: number
): number {
  let timeCursor = 0;
  let visualCursor = 0;
  for (const layout of rowLayouts) {
    const { rowMinHeightPx, estimateHeightPx } = layout;
    if (timeY <= timeCursor + rowMinHeightPx) {
      return visualCursor + (timeY - timeCursor);
    }
    timeCursor += rowMinHeightPx;
    visualCursor += estimateHeightPx;
  }
  return visualCursor;
}

/**
 * 行ごとの作業時間領域（rowMinHeightPx）だけを時間軸にし、8H 目盛を視覚 Y へ写像する。
 * footer chip や行間 padding は時間軸に含めない。
 */
export function computeGanttEightHourTickVisualPositions(
  rowLayouts: readonly LeaderBoardGanttRowLayout[]
): number[] {
  const tickSpanPx = GANTT_EIGHT_HOURS_MINUTES * GANTT_PX_PER_MINUTE;
  const totalTimePx = rowLayouts.reduce((sum, layout) => sum + layout.rowMinHeightPx, 0);
  if (!Number.isFinite(totalTimePx) || totalTimePx <= 0 || tickSpanPx <= 0) {
    return [0];
  }
  const positions: number[] = [];
  for (let timeY = 0; timeY < totalTimePx; timeY += tickSpanPx) {
    positions.push(mapGanttTimeYToVisualY(rowLayouts, timeY));
  }
  return positions;
}

/**
 * 行配列から仮想リスト総高見積を算出する。
 */
export function computeGanttTotalEstimateHeightPx(
  rowLayouts: readonly LeaderBoardGanttRowLayout[]
): number {
  let sum = 0;
  for (const layout of rowLayouts) {
    sum += layout.estimateHeightPx;
  }
  return sum;
}
