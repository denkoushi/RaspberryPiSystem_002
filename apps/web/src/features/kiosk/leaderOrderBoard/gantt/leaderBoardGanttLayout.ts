import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX,
  GANTT_FALLBACK_PX_PER_MINUTE,
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_RULER_MAX_BAND_COUNT,
  GANTT_ROW_VERTICAL_PADDING_PX
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

export type GanttRulerSegment = {
  topPx: number;
  heightPx: number;
  bandIndex: number;
};

export type LeaderBoardGanttSlotLayout = {
  pxPerMinute: number;
  rowLayouts: LeaderBoardGanttRowLayout[];
  rulerSegments: GanttRulerSegment[];
  containerMinHeightPx: number;
  totalEstimateHeightPx: number;
  eightHourBoundaryEndY: number;
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

export function mapGanttTimeYToVisualY(
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

function computeEightHourBoundaryEndY(params: {
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
    return availableWorkHeightPx;
  }

  return clamp(
    mapGanttTimeYToVisualY(rowLayouts, GANTT_EIGHT_HOURS_MINUTES * pxPerMinute),
    0,
    rulerHeightPx
  );
}

function computeEightHourBoundaryEndYs(params: {
  rowLayouts: readonly LeaderBoardGanttRowLayout[];
  availableWorkHeightPx: number;
  rulerHeightPx: number;
  pxPerMinute: number;
  totalRequiredMinutes: number;
  totalEstimateHeightPx: number;
}): number[] {
  const tickSpanTimePx = GANTT_EIGHT_HOURS_MINUTES * params.pxPerMinute;
  if (tickSpanTimePx <= 0) {
    return [params.rulerHeightPx];
  }

  const canShowUnusedGap = params.totalEstimateHeightPx <= params.availableWorkHeightPx;
  if (params.totalRequiredMinutes <= GANTT_EIGHT_HOURS_MINUTES && canShowUnusedGap) {
    return [params.availableWorkHeightPx];
  }

  const totalWorkPx = sumWorkHeightPx(params.rowLayouts);
  const boundaryEndYs: number[] = [];

  for (let bandIndex = 1; bandIndex <= GANTT_RULER_MAX_BAND_COUNT; bandIndex += 1) {
    const timeY = tickSpanTimePx * bandIndex;
    if (timeY > totalWorkPx) break;

    const visualY = clamp(
      mapGanttTimeYToVisualY(params.rowLayouts, timeY),
      0,
      params.rulerHeightPx
    );

    const lastEndY = boundaryEndYs[boundaryEndYs.length - 1];
    if (lastEndY !== undefined) {
      if (visualY <= lastEndY) break;
      if (visualY - lastEndY < 1) continue;
    }

    boundaryEndYs.push(visualY);
    if (visualY >= params.rulerHeightPx) break;
  }

  return boundaryEndYs;
}

function extendLastSegmentToHeight(
  segments: GanttRulerSegment[],
  targetHeightPx: number
): GanttRulerSegment[] {
  if (segments.length === 0) {
    if (targetHeightPx <= 0) return [];
    return [{ topPx: 0, heightPx: targetHeightPx, bandIndex: 0 }];
  }

  const normalized = segments.map((segment) => ({ ...segment }));
  const last = normalized[normalized.length - 1];
  const logicalEnd = last.topPx + last.heightPx;
  if (targetHeightPx > logicalEnd) {
    last.heightPx += targetHeightPx - logicalEnd;
  }
  return normalized;
}

function mergeSubPixelSegments(segments: readonly GanttRulerSegment[]): GanttRulerSegment[] {
  if (segments.length <= 1) return [...segments];

  const merged: GanttRulerSegment[] = [];
  for (const segment of segments) {
    if (segment.heightPx < 1 && merged.length > 0) {
      const previous = merged[merged.length - 1];
      previous.heightPx += segment.heightPx;
      continue;
    }
    if (segment.heightPx > 0) {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function capRulerSegmentCount(segments: readonly GanttRulerSegment[], maxSegments: number): GanttRulerSegment[] {
  if (segments.length <= maxSegments || maxSegments <= 0) return [...segments];

  const capped = segments.map((segment) => ({ ...segment }));
  while (capped.length > maxSegments) {
    const mergeIndex = capped.length - 2;
    if (mergeIndex < 0) break;
    const previous = capped[mergeIndex];
    const last = capped[mergeIndex + 1];
    previous.heightPx += last.heightPx;
    capped.pop();
  }
  return capped;
}

function computeGanttRulerSegments(params: {
  rowLayouts: readonly LeaderBoardGanttRowLayout[];
  availableWorkHeightPx: number;
  rulerHeightPx: number;
  pxPerMinute: number;
  totalRequiredMinutes: number;
  totalEstimateHeightPx: number;
}): GanttRulerSegment[] {
  const boundaryEndYs = computeEightHourBoundaryEndYs(params);
  const segments: GanttRulerSegment[] = [];
  let topPx = 0;

  for (let bandIndex = 0; bandIndex < boundaryEndYs.length; bandIndex += 1) {
    const endY = boundaryEndYs[bandIndex];
    const heightPx = endY - topPx;
    if (heightPx > 0) {
      segments.push({ topPx, heightPx, bandIndex });
      topPx = endY;
    }
  }

  const withLogicalTail = extendLastSegmentToHeight(segments, params.rulerHeightPx);
  const merged = mergeSubPixelSegments(withLogicalTail);
  return capRulerSegmentCount(merged, GANTT_RULER_MAX_BAND_COUNT);
}

/**
 * 仮想化後の実描画高さに合わせ、最終セグメントを延長してガター末尾まで連続させる。
 */
export function normalizeRulerSegmentsForRenderHeight(
  segments: readonly GanttRulerSegment[],
  renderHeightPx: number
): GanttRulerSegment[] {
  if (renderHeightPx <= 0) return [];
  const normalized = extendLastSegmentToHeight([...segments], renderHeightPx);
  return capRulerSegmentCount(normalized, GANTT_RULER_MAX_BAND_COUNT);
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

  const eightHourBoundaryEndY = computeEightHourBoundaryEndY({
    rowLayouts,
    availableWorkHeightPx,
    rulerHeightPx,
    pxPerMinute,
    totalRequiredMinutes,
    totalEstimateHeightPx
  });

  const rulerSegments = computeGanttRulerSegments({
    rowLayouts,
    availableWorkHeightPx,
    rulerHeightPx,
    pxPerMinute,
    totalRequiredMinutes,
    totalEstimateHeightPx
  });

  return {
    pxPerMinute,
    rowLayouts,
    rulerSegments,
    containerMinHeightPx,
    totalEstimateHeightPx,
    eightHourBoundaryEndY,
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
