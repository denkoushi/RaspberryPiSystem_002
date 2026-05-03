import type { DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';

/** シナリオ実行結果の区分（UI・ログ向けの要約） */
export type DgxResourceScenarioOutcomeKind = 'success' | 'partial_failure' | 'noop';

export type DgxResourceScenarioExecuteResult = {
  scenarioId: DgxOrchestrationScenarioId;
  success: boolean;
  completedStepOrders: number[];
  completedPolicyApplied: boolean;
  failureMessageJa?: string;
  recommendedNextJa?: string;
  outcomeKind?: DgxResourceScenarioOutcomeKind;
};
