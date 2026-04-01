import type { LeaderBoardRow } from './types';

export type OrderMutationStep =
  | { kind: 'clear'; rowId: string; resourceCd: string }
  | { kind: 'assign'; rowId: string; resourceCd: string; orderNumber: number };

/**
 * クリア → 付与の順で実行するステップ列を生成する。
 * - クリア: 現在 `processingOrder` がある行のみ（同一 location の割当削除）
 * - 付与: `sortedRows` の並びで 1..n
 */
export function buildReorderPlan(sortedRows: LeaderBoardRow[], resourceCd: string): OrderMutationStep[] {
  const steps: OrderMutationStep[] = [];
  for (const row of sortedRows) {
    if (row.processingOrder != null) {
      steps.push({ kind: 'clear', rowId: row.id, resourceCd });
    }
  }
  sortedRows.forEach((row, index) => {
    steps.push({ kind: 'assign', rowId: row.id, resourceCd, orderNumber: index + 1 });
  });
  return steps;
}
