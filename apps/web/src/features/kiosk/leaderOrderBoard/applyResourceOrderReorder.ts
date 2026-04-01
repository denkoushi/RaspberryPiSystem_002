import { buildReorderPlan } from './buildReorderPlan';
import { assertAllRowsMatchResourceCd, assertNonEmptyResource, assertResourceRowsWithinOrderLimit } from './validateApplyPreconditions';

import type { LeaderBoardRow } from './types';

export type UpdateOrderFn = (params: {
  rowId: string;
  resourceCd: string;
  orderNumber: number | null;
}) => Promise<void>;

/**
 * 表示用納期でソート済みの全行を、2段（clear → assign）で API に反映する。
 * 呼び出し側で `assertCompletePage` と専用フェッチを済ませた行だけを渡すこと。
 */
export async function applyResourceOrderReorder(
  sortedRows: LeaderBoardRow[],
  resourceCd: string,
  updateOrder: UpdateOrderFn
): Promise<void> {
  assertNonEmptyResource(sortedRows);
  assertAllRowsMatchResourceCd(sortedRows, resourceCd);
  assertResourceRowsWithinOrderLimit(sortedRows);

  const plan = buildReorderPlan(sortedRows, resourceCd);
  for (const step of plan) {
    if (step.kind === 'clear') {
      await updateOrder({ rowId: step.rowId, resourceCd: step.resourceCd, orderNumber: null });
    } else {
      await updateOrder({ rowId: step.rowId, resourceCd: step.resourceCd, orderNumber: step.orderNumber });
    }
  }
}
