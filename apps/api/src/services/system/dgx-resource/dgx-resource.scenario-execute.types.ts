import type { DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';

/** シナリオ実行結果の区分（UI・ログ向けの要約） */
export type DgxResourceScenarioOutcomeKind = 'success' | 'partial_failure' | 'noop';

/** Strict Ready で検証したゲートの要約（画面表示向け）。 */
export type DgxScenarioReadinessCheckJa = {
  code:
    | 'inference_business'
    | 'model_profile_active'
    | 'model_profile_backend'
    | 'model_profile_vision_runtime'
    | 'private_comfy'
    | 'experiment_lab';
  satisfied: boolean;
  detailJa: string;
};

/** Ready タイムアウト等での安全復帰（完全ロールバックではない場合あり）。 */
export type DgxScenarioSafeRollbackJa = {
  attempted: boolean;
  policyRestoredJa?: string;
  workloadStepsJa?: string[];
};

export type DgxResourceScenarioExecuteResult = {
  scenarioId: DgxOrchestrationScenarioId;
  success: boolean;
  completedStepOrders: number[];
  completedPolicyApplied: boolean;
  failureMessageJa?: string;
  recommendedNextJa?: string;
  outcomeKind?: DgxResourceScenarioOutcomeKind;
  /** Ready フェーズ達成結果（ゲート一覧） */
  readinessChecksJa?: readonly DgxScenarioReadinessCheckJa[];
  readinessSummaryJa?: string;
  /** 失敗後に試みた復帰 */
  rollback?: DgxScenarioSafeRollbackJa;
};
