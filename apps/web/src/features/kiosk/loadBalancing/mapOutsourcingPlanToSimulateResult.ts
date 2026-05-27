import type {
  ProductionScheduleLoadBalancingOutsourcingPlanResponse,
  ProductionScheduleLoadBalancingOutsourcingSimulateResponse
} from '../../../api/client';

/** plan 応答の before/after をチャート・明細用 simulate 形に変換（追加 API 呼び出し不要）。 */
export function mapOutsourcingPlanToSimulateResult(
  plan: ProductionScheduleLoadBalancingOutsourcingPlanResponse
): ProductionScheduleLoadBalancingOutsourcingSimulateResponse {
  return {
    siteKey: plan.siteKey,
    yearMonth: plan.yearMonth,
    mode: 'outsourcing',
    beforeResources: plan.beforeResources,
    afterResources: plan.afterResources,
    appliedRows: [],
    skippedRows: [],
    summary: {
      selectedCount: plan.selectedCandidateIds.length,
      appliedCount: plan.selectedCandidateIds.length,
      skippedCount: 0,
      totalReducedMinutes: plan.totalReducedMinutes,
      remainingOverMinutes: plan.remainingOverMinutes
    }
  };
}
