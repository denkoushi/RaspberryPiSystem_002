import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';
import { buildFkojunstProductionScheduleListVisibleScalarSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';

export type OrderAssignmentRetentionState = {
  effectiveCompleted: boolean;
  listVisible: boolean;
};

/**
 * 順位割当を保持すべきか（A+α 統合）。
 * retain ⇔ 未完 かつ キオスク一覧に載る（fkmail S/R/C/X）。
 */
export function shouldRetainOrderAssignment(state: OrderAssignmentRetentionState): boolean {
  return !state.effectiveCompleted && state.listVisible;
}

export function shouldReleaseOrderAssignment(state: OrderAssignmentRetentionState): boolean {
  return !shouldRetainOrderAssignment(state);
}

/** SQL: 実効完了（手動 OR 外部）。`p` / `ext` JOIN 済み前提。 */
export { buildProductionScheduleEffectiveCompletedSql as buildOrderAssignmentEffectiveCompletedScalarSql };

/** SQL: キオスク一覧可視（fkmail 正本）。`fkmail` JOIN 済み前提。 */
export { buildFkojunstProductionScheduleListVisibleScalarSql as buildOrderAssignmentListVisibleScalarSql };
