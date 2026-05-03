import type { DgxOrchestrationScenarioIdApi, DgxOperatorConsoleActionApi } from '../../../api/dgx-resource.types';

/** 画面上のカード並び順（API の operatorActions と独立・欠落時は並びのみスキップ） */
export const DGX_PRIMARY_TASK_SCENARIO_ORDER: readonly DgxOrchestrationScenarioIdApi[] = [
  'business_to_private',
  'private_to_business',
  'business_to_experiment',
  'experiment_to_business',
] as const;

export function orderPrimaryScenarioActions(
  operatorActions: DgxOperatorConsoleActionApi[]
): DgxOperatorConsoleActionApi[] {
  const byScenario = new Map(operatorActions.map((a) => [a.scenarioId, a]));
  return DGX_PRIMARY_TASK_SCENARIO_ORDER.map((id) => byScenario.get(id)).filter(
    (a): a is DgxOperatorConsoleActionApi => a != null
  );
}
