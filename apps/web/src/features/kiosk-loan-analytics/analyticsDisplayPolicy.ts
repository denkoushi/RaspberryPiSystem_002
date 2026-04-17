import type { AssetRow, EmployeeRow, PeriodEventRow } from './view-model';

/**
 * キオスク集計画面の「一覧を畳む」上限。変更時は UI とこの定数を同期し、ユニットテストで固定する。
 */
export const ANALYTICS_KIOSK_DISPLAY_LIMITS = {
  topRankedEmployees: 8,
  topRankedAssets: 8,
  todayEventsMax: 5
} as const;

export type AnalyticsKioskDisplayLimits = typeof ANALYTICS_KIOSK_DISPLAY_LIMITS;

/** 一覧表示モード: Top N サマリー / 全件（カード内スクロール。DOM 肥大化防止で上限あり） */
export type AnalyticsListMode = 'top' | 'all';

/** 全件モード時の最大行数（ブラウザ負荷対策） */
export const ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS = 500;

/** 社員の並び: 期間内 持出+返却 の合計が大きい順（同率は表示名）。 */
export function compareEmployeesByPeriodActivity(a: EmployeeRow, b: EmployeeRow): number {
  const score = (r: EmployeeRow) => r.periodBorrowCount + r.periodReturnCount;
  const d = score(b) - score(a);
  if (d !== 0) return d;
  return a.displayName.localeCompare(b.displayName, 'ja');
}

export function topRankedEmployees(rows: EmployeeRow[], limit: number): EmployeeRow[] {
  if (limit <= 0) return [];
  return [...rows].sort(compareEmployeesByPeriodActivity).slice(0, limit);
}

/** 資産: 期間内持出回数の降順（同率は名称）。 */
export function compareAssetsByPeriodBorrowDesc(a: AssetRow, b: AssetRow): number {
  const d = b.periodBorrowCount - a.periodBorrowCount;
  if (d !== 0) return d;
  return a.name.localeCompare(b.name, 'ja');
}

export function topRankedAssetsByBorrow(rows: AssetRow[], limit: number): AssetRow[] {
  if (limit <= 0) return [];
  return [...rows].sort(compareAssetsByPeriodBorrowDesc).slice(0, limit);
}

/** 社員ランキング: Top N または全件（上限付き） */
export function selectEmployeesForDisplay(rows: EmployeeRow[], topLimit: number, mode: AnalyticsListMode): EmployeeRow[] {
  if (mode === 'top') {
    return topRankedEmployees(rows, topLimit);
  }
  const sorted = [...rows].sort(compareEmployeesByPeriodActivity);
  return sorted.slice(0, Math.min(sorted.length, ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS));
}

/** 資産ランキング: Top N または全件（上限付き） */
export function selectAssetsForDisplay(rows: AssetRow[], topLimit: number, mode: AnalyticsListMode): AssetRow[] {
  if (mode === 'top') {
    return topRankedAssetsByBorrow(rows, topLimit);
  }
  const sorted = [...rows].sort(compareAssetsByPeriodBorrowDesc);
  return sorted.slice(0, Math.min(sorted.length, ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS));
}

/** 全件モードで切り詰めたか（UI でバッジ文言に利用） */
export function isFullListTruncated(totalRows: number, mode: AnalyticsListMode): boolean {
  return mode === 'all' && totalRows > ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS;
}

export function sortPeriodEventsNewestFirst(rows: PeriodEventRow[]): PeriodEventRow[] {
  return [...rows].sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());
}

export function takeTodayEventsForDisplay(
  rows: PeriodEventRow[],
  limit: number,
  mode: AnalyticsListMode = 'top'
): PeriodEventRow[] {
  const sorted = sortPeriodEventsNewestFirst(rows);
  if (mode === 'all') {
    return sorted.slice(0, Math.min(sorted.length, ANALYTICS_KIOSK_FULL_LIST_MAX_ROWS));
  }
  if (limit <= 0) return [];
  return sorted.slice(0, limit);
}

export function countPeriodEventKinds(rows: PeriodEventRow[]): { borrowCount: number; returnCount: number } {
  let borrowCount = 0;
  let returnCount = 0;
  for (const r of rows) {
    if (r.kind === 'BORROW') borrowCount += 1;
    else returnCount += 1;
  }
  return { borrowCount, returnCount };
}

/**
 * 期間サマリ上の「返却完了率」指標: 返却件数 / 持出件数（%）。持出が 0 の月は意味が薄いので null。
 */
export function periodReturnCompletionRatePercent(periodBorrowCount: number, periodReturnCount: number): number | null {
  if (periodBorrowCount <= 0) return null;
  return Math.min(100, Math.round((periodReturnCount / periodBorrowCount) * 100));
}

export type AssetInventorySummary = {
  availableCount: number;
  inUseCount: number;
  overdueCount: number;
};

/** マスタ行の状態ラベル集計（チップ表示用）。超過は inUse と重複し得る。 */
export function summarizeAssetInventory(rows: AssetRow[]): AssetInventorySummary {
  let availableCount = 0;
  let inUseCount = 0;
  let overdueCount = 0;
  for (const r of rows) {
    if (r.openIsOverdue) overdueCount += 1;
    if (r.isOutNow || r.status === 'IN_USE') inUseCount += 1;
    else if (r.status === 'AVAILABLE') availableCount += 1;
  }
  return { availableCount, inUseCount, overdueCount };
}
