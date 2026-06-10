import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX,
  GANTT_FALLBACK_PX_PER_MINUTE,
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_ROW_VERTICAL_PADDING_PX,
  GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
} from './leaderBoardGanttConstants';

export type GanttSlotRowInput = {
  requiredMinutes: number;
  hasFooterChips?: boolean;
};

export type LeaderBoardGanttRowLayout = {
  /** 時間軸上の行高（8H ルーラー写像用） */
  workHeightPx: number;
  /** DOM min-height（可読性確保） */
  visualMinHeightPx: number;
  /** 仮想リスト見積（padding / footer chip 含む） */
  estimateHeightPx: number;
};

export type GanttTickMark = {
  topPx: number;
  kind: 'origin' | 'boundary';
};

export type LeaderBoardGanttSlotLayout = {
  pxPerMinute: number;
  rowLayouts: LeaderBoardGanttRowLayout[];
  tickMarks: GanttTickMark[];
  containerMinHeightPx: number;
  totalEstimateHeightPx: number;
  eightHourBoundaryY: number;
  rulerHeightPx: number;
  totalRequiredMinutes: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function resolveAvailableWorkHeightPx(availableWorkHeightPx: number): number {
  if (!Number.isFinite(availableWorkHeightPx) || availableWorkHeightPx <= 0) {
    return GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX;
  }
  return availableWorkHeightPx;
}

function computeRowLayouts(params: {
  rows: readonly GanttSlotRowInput[];
  pxPerMinute: number;
}): LeaderBoardGanttRowLayout[] {
  return params.rows.map((row) => {
    const minutes = parseLeaderBoardRequiredMinutes(row.requiredMinutes);
    const workHeightPx = minutes * params.pxPerMinute;
    const visualMinHeightPx = Math.max(workHeightPx, GANTT_MIN_ROW_HEIGHT_PX);
    const estimateHeightPx =
      visualMinHeightPx +
      GANTT_ROW_VERTICAL_PADDING_PX +
      (row.hasFooterChips ? GANTT_FOOTER_CHIPS_EXTRA_PX : 0);
    return {
      workHeightPx,
      visualMinHeightPx,
      estimateHeightPx
    };
  });
}

function sumWorkHeightPx(rowLayouts: readonly LeaderBoardGanttRowLayout[]): number {
  let sum = 0;
  for (const layout of rowLayouts) {
    sum += layout.workHeightPx;
  }
  return sum;
}

function sumEstimateHeightPx(rowLayouts: readonly LeaderBoardGanttRowLayout[]): number {
  let sum = 0;
  for (const layout of rowLayouts) {
    sum += layout.estimateHeightPx;
  }
  return sum;
}

function mapGanttTimeYToVisualY(
  rowLayouts: readonly LeaderBoardGanttRowLayout[],
  timeY: number
): number {
  let timeCursor = 0;
  let visualCursor = 0;
  for (const layout of rowLayouts) {
    const { workHeightPx, visualMinHeightPx, estimateHeightPx } = layout;
    if (workHeightPx <= 0) {
      visualCursor += estimateHeightPx;
      continue;
    }
    if (timeY <= timeCursor + workHeightPx) {
      const ratio = (timeY - timeCursor) / workHeightPx;
      return visualCursor + ratio * visualMinHeightPx;
    }
    timeCursor += workHeightPx;
    visualCursor += estimateHeightPx;
  }
  return visualCursor;
}

function clampTickTopPx(topPx: number, rulerHeightPx: number, lineHeightPx: number): number {
  const maxTop = Math.max(0, rulerHeightPx - lineHeightPx);
  return clamp(topPx, 0, maxTop);
}

function computeEightHourBoundaryY(params: {
  rowLayouts: readonly LeaderBoardGanttRowLayout[];
  availableWorkHeightPx: number;
  rulerHeightPx: number;
  pxPerMinute: number;
  totalRequiredMinutes: number;
  totalEstimateHeightPx: number;
}): number {
  const {
    rowLayouts,
    availableWorkHeightPx,
    rulerHeightPx,
    pxPerMinute,
    totalRequiredMinutes,
    totalEstimateHeightPx
  } = params;

  const canShowUnusedGap = totalEstimateHeightPx <= availableWorkHeightPx;
  if (totalRequiredMinutes <= GANTT_EIGHT_HOURS_MINUTES && canShowUnusedGap) {
    return clampTickTopPx(
      availableWorkHeightPx - GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX,
      availableWorkHeightPx,
      GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
    );
  }

  return clampTickTopPx(
    mapGanttTimeYToVisualY(rowLayouts, GANTT_EIGHT_HOURS_MINUTES * pxPerMinute),
    rulerHeightPx,
    GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
  );
}

function computeGanttTickMarks(params: {
  rowLayouts: readonly LeaderBoardGanttRowLayout[];
  rulerHeightPx: number;
  pxPerMinute: number;
  eightHourBoundaryY: number;
}): GanttTickMark[] {
  const marks: GanttTickMark[] = [{ topPx: 0, kind: 'origin' }];

  const boundaryYs = new Set<number>();
  boundaryYs.add(params.eightHourBoundaryY);

  const totalWorkPx = sumWorkHeightPx(params.rowLayouts);
  const tickSpanTimePx = GANTT_EIGHT_HOURS_MINUTES * params.pxPerMinute;
  if (totalWorkPx > tickSpanTimePx && tickSpanTimePx > 0) {
    for (let timeY = tickSpanTimePx * 2; timeY < totalWorkPx; timeY += tickSpanTimePx) {
      const visualY = mapGanttTimeYToVisualY(params.rowLayouts, timeY);
      boundaryYs.add(
        clampTickTopPx(visualY, params.rulerHeightPx, GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX)
      );
    }
  }

  for (const topPx of boundaryYs) {
    if (topPx > 0) {
      marks.push({ topPx, kind: 'boundary' });
    }
  }

  return marks.sort((a, b) => a.topPx - b.topPx);
}

/**
 * 資源スロット単位の可変 8H ルーラーレイアウト。
 * 時間軸（workHeightPx）と表示最小高さ（visualMinHeightPx）を分離する。
 */
export function computeGanttSlotLayout(params: {
  rows: readonly GanttSlotRowInput[];
  availableWorkHeightPx: number;
}): LeaderBoardGanttSlotLayout {
  const availableWorkHeightPx = resolveAvailableWorkHeightPx(params.availableWorkHeightPx);

  let totalRequiredMinutes = 0;
  for (const row of params.rows) {
    totalRequiredMinutes += parseLeaderBoardRequiredMinutes(row.requiredMinutes);
  }

  const scaleMinutes = Math.max(totalRequiredMinutes, GANTT_EIGHT_HOURS_MINUTES);
  const pxPerMinute =
    availableWorkHeightPx > 0 ? availableWorkHeightPx / scaleMinutes : GANTT_FALLBACK_PX_PER_MINUTE;

  const rowLayouts = computeRowLayouts({ rows: params.rows, pxPerMinute });
  const totalEstimateHeightPx = sumEstimateHeightPx(rowLayouts);
  const containerMinHeightPx = Math.max(totalEstimateHeightPx, availableWorkHeightPx);

  const rulerHeightPx = containerMinHeightPx;

  const eightHourBoundaryY = computeEightHourBoundaryY({
    rowLayouts,
    availableWorkHeightPx,
    rulerHeightPx,
    pxPerMinute,
    totalRequiredMinutes,
    totalEstimateHeightPx
  });

  const tickMarks = computeGanttTickMarks({
    rowLayouts,
    rulerHeightPx,
    pxPerMinute,
    eightHourBoundaryY
  });

  return {
    pxPerMinute,
    rowLayouts,
    tickMarks,
    containerMinHeightPx,
    totalEstimateHeightPx,
    eightHourBoundaryY,
    rulerHeightPx,
    totalRequiredMinutes
  };
}

/** @deprecated 可変スケールへ移行。テスト互換のため残す。 */
export type LegacyLeaderBoardGanttRowLayout = {
  rowMinHeightPx: number;
  estimateHeightPx: number;
};

/** @deprecated computeGanttSlotLayout を使用 */
export function computeGanttRowLayout(params: {
  requiredMinutes: number;
  hasFooterChips?: boolean;
}): LegacyLeaderBoardGanttRowLayout {
  const slot = computeGanttSlotLayout({
    rows: [{ requiredMinutes: params.requiredMinutes, hasFooterChips: params.hasFooterChips }],
    availableWorkHeightPx: GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX
  });
  const row = slot.rowLayouts[0];
  return {
    rowMinHeightPx: row?.visualMinHeightPx ?? GANTT_MIN_ROW_HEIGHT_PX,
    estimateHeightPx: row?.estimateHeightPx ?? GANTT_MIN_ROW_HEIGHT_PX
  };
}

/** @deprecated computeGanttSlotLayout を使用 */
export function computeGanttTotalEstimateHeightPx(
  rowLayouts: readonly LegacyLeaderBoardGanttRowLayout[]
): number {
  let sum = 0;
  for (const layout of rowLayouts) {
    sum += layout.estimateHeightPx;
  }
  return sum;
}
