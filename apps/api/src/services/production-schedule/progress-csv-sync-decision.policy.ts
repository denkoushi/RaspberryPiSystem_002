import { COMPLETED_PROGRESS_VALUE } from './constants.js';

export type CsvProgressSyncRowDecision =
  | { kind: 'skip' }
  | { kind: 'apply'; isCompleted: boolean };

/**
 * 生産日程 CSV の `rowData.progress` から `ProductionScheduleProgress` へ同期するか決める。
 *
 * - CSV が空の progress は「情報なし」とみなし、**既に手動完了の行を未完へ戻さない**。
 * - `完了` のみ true へ同期する。
 * - その他の値は同期しない（従来の toIsCompleted=null と同じ）。
 */
export function decideCsvProgressSyncForProductionScheduleRow(params: {
  progressNormalized: string;
  existingIsCompleted: boolean | undefined;
}): CsvProgressSyncRowDecision {
  const p = params.progressNormalized;
  if (p === COMPLETED_PROGRESS_VALUE) {
    return { kind: 'apply', isCompleted: true };
  }
  if (p === '') {
    if (params.existingIsCompleted === true) {
      return { kind: 'skip' };
    }
    return { kind: 'apply', isCompleted: false };
  }
  return { kind: 'skip' };
}
