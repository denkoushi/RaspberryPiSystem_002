import {
  GANTT_DEFAULT_CAPACITY_MINUTES,
  GANTT_MAX_CAPACITY_MINUTES,
  GANTT_MIN_CAPACITY_MINUTES
} from './leaderBoardGanttConstants';

/** 資源スロットごとの基準時間（分）解決に使う文脈。 */
export type LeaderBoardGanttCapacityContext = {
  siteKey?: string;
  deviceScopeKey?: string;
  slotIndex: number;
  resourceCd: string;
};

/**
 * 任意の基準時間（分）を正規化する。
 * 無効値・0・負数・NaN・範囲外は既定 480 分へ戻す。
 */
export function normalizeLeaderBoardGanttCapacityMinutes(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return GANTT_DEFAULT_CAPACITY_MINUTES;
  }
  if (raw < GANTT_MIN_CAPACITY_MINUTES || raw > GANTT_MAX_CAPACITY_MINUTES) {
    return GANTT_DEFAULT_CAPACITY_MINUTES;
  }
  return raw;
}

/**
 * スロット文脈から基準時間（分）を解決する。
 * 当面は全スロット 480 分。将来は siteKey / deviceScopeKey / slotIndex / resourceCd で上書き可能。
 *
 * 例（将来設定候補・本番未使用）: 305→480, 584→720, 585→1440
 */
export function resolveLeaderBoardGanttCapacityMinutes(
  _context: LeaderBoardGanttCapacityContext
): number {
  return GANTT_DEFAULT_CAPACITY_MINUTES;
}
