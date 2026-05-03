/** API の DgxPolicyMode と同一キー（表示は dgxResourceProfiles で定義） */
export type DgxPolicyModeApi = 'business_first' | 'private_ok' | 'experiment_first';

export type DgxControlTargetIdApi =
  | 'system-prod-gateway'
  | 'system-prod-inference'
  | 'system-prod-embedding'
  | 'private-comfyui'
  | 'experiment-lab'
  | 'spark-host'
  | 'metrics-kpi';

export type DgxControlTargetKindApi = 'gateway' | 'http_probe' | 'metrics_source';

export type DgxControlTargetCapabilityApi = 'readStatus' | 'start' | 'stop';

export type DgxServiceStatusKind = 'running' | 'degraded' | 'stopped' | 'unknown';

export type DgxControlTargetSnapshotApi = {
  id: DgxControlTargetIdApi;
  kind: DgxControlTargetKindApi;
  displayName: string;
  capabilities: DgxControlTargetCapabilityApi[];
  status: DgxServiceStatusKind;
  badges: string[];
  metaLines: string[];
};

export type DgxResourceKpis = {
  gpuUtilPct: number | null;
  unifiedMemoryUsedGiB: number | null;
  unifiedMemoryTotalGiB: number | null;
  freeMemoryGiB: number | null;
  policyMode: DgxPolicyModeApi;
  policyLabel: string;
};

export type DgxResourceServiceCard = {
  id: string;
  name: string;
  status: DgxServiceStatusKind;
  badges: string[];
  metaLines: string[];
};

export type DgxSparkHostOverview = {
  configured: boolean;
  probedAt: string;
  status: DgxServiceStatusKind;
  probeUrl?: string;
  httpStatus?: number;
  errorBrief?: string;
};

export type DgxResourceWarmWindow = {
  enabled: boolean;
  timeZone?: string;
  startHourInclusive?: number;
  endHourExclusive?: number;
};

export type DgxOrchestrationScenarioIdApi =
  | 'business_to_private'
  | 'private_to_business'
  | 'business_to_experiment'
  | 'experiment_to_business';

export type DgxResourceMonitoringAlertApi = {
  level: 'info' | 'warning' | 'danger';
  code: string;
  title: string;
  detail: string;
};

export type DgxResourceScenarioFailureSummaryApi = {
  scenarioId: string;
  at: string;
  message: string;
  completedStepOrders: number[];
};

export type DgxResourceMonitoringSummaryApi = {
  activeInferenceSummary: string | null;
  sparkSummaryJa: string;
  alerts: DgxResourceMonitoringAlertApi[];
  targetHighlights: Array<{ id: string; label: string; status: DgxServiceStatusKind }>;
  lastScenarioFailure: DgxResourceScenarioFailureSummaryApi | null;
};

export type ScenarioWorkloadStepPreviewApi = {
  kind: 'workload';
  order: number;
  targetId: string;
  action: 'start' | 'stop';
  summaryJa: string;
};

export type ScenarioPolicyStepPreviewApi = {
  kind: 'policy';
  order: number;
  policyMode: DgxPolicyModeApi;
  summaryJa: string;
};

export type ScenarioStepPreviewApi = ScenarioWorkloadStepPreviewApi | ScenarioPolicyStepPreviewApi;

export type ScenarioPlanPreviewApi = {
  scenarioId: DgxOrchestrationScenarioIdApi;
  targetPolicyMode: DgxPolicyModeApi;
  applyWorkloadChanges: boolean;
  planFingerprint: string;
  steps: ScenarioStepPreviewApi[];
  warnings: string[];
};

export type DgxResourceScenarioExecuteResultApi = {
  scenarioId: DgxOrchestrationScenarioIdApi;
  success: boolean;
  completedStepOrders: number[];
  completedPolicyApplied: boolean;
  failureMessageJa?: string;
  recommendedNextJa?: string;
  outcomeKind?: 'success' | 'partial_failure' | 'noop';
  readinessChecksJa?: readonly {
    code: 'inference_business' | 'private_comfy' | 'experiment_lab';
    satisfied: boolean;
    detailJa: string;
  }[];
  readinessSummaryJa?: string;
  rollback?: {
    attempted: boolean;
    policyRestoredJa?: string;
    workloadStepsJa?: string[];
  };
};

export type DgxOperatorRiskLevelApi = 'low' | 'medium' | 'high';

export type DgxOperatorWorkloadIdApi = 'business_vlm' | 'private_comfy' | 'experiment_lab';

export type DgxOperatorWorkloadApi = {
  id: DgxOperatorWorkloadIdApi;
  labelJa: string;
  purposeJa: string;
  risk: DgxOperatorRiskLevelApi;
  status: DgxServiceStatusKind;
  statusHeadlineJa: string;
  detailHintJa?: string;
  relatedTargetIds: string[];
  runtimeControlConfigured: boolean;
};

export type DgxOperatorConsoleActionApi = {
  id: DgxOrchestrationScenarioIdApi;
  labelJa: string;
  subtitleJa: string;
  scenarioId: DgxOrchestrationScenarioIdApi;
  primary: boolean;
  disabledReasonJa?: string;
};

export type DgxResourceOperatorConsoleApi = {
  workloads: DgxOperatorWorkloadApi[];
  operatorSummary: {
    headlineJa: string;
    policyMode: DgxPolicyModeApi;
    policyLabelJa: string;
    previousMode: DgxPolicyModeApi | null;
    previousPolicyLabelJa: string | null;
    comfyStartBlockedHint: boolean;
    inferenceSparkLineJa: string | null;
    alertPreviewJa: string[];
  };
  operatorActions: DgxOperatorConsoleActionApi[];
};

export type DgxResourceOverview = {
  generatedAt: string;
  kpis: DgxResourceKpis;
  policy: {
    mode: DgxPolicyModeApi;
    previousMode: DgxPolicyModeApi | null;
    comfyStartBlockedHint: boolean;
  };
  runtime: {
    localLlmMode: 'always_on' | 'on_demand';
    runtimeControlConfigured: boolean;
    warmWindow: DgxResourceWarmWindow;
  };
  optionalProbes: {
    metricsConfigured: boolean;
    comfyHealthConfigured: boolean;
    embeddingHealthConfigured: boolean;
    sparkHostConfigured: boolean;
    comfyRuntimeControlConfigured: boolean;
    experimentLabHealthConfigured: boolean;
    experimentLabRuntimeControlConfigured: boolean;
  };
  targets?: DgxControlTargetSnapshotApi[];
  sparkHost: DgxSparkHostOverview;
  /** @deprecated 後方互換。表示は targets を優先 */
  services: DgxResourceServiceCard[];
  notes: string[];
  monitoring: DgxResourceMonitoringSummaryApi;
  /** 運用者向け（API が返す新モデル。互換のため一時的に省略可能） */
  operator?: DgxResourceOperatorConsoleApi;
};

export type DgxResourceEvent = {
  id: string;
  at: string;
  message: string;
};

export type DgxResourceEventsResponse = {
  events: DgxResourceEvent[];
};

export type DgxResourceActionBody =
  | { type: 'LOCAL_LLM_START'; reason?: string }
  | { type: 'LOCAL_LLM_STOP'; reason?: string }
  | { type: 'SET_POLICY'; policyMode: DgxPolicyModeApi; applyWorkloadChanges?: boolean }
  | {
      type: 'EXECUTE_TARGET_ACTION';
      targetId: DgxControlTargetIdApi;
      action: 'start' | 'stop';
      reason?: string;
    }
  | { type: 'PREVIEW_ORCHESTRATION_SCENARIO'; scenarioId: DgxOrchestrationScenarioIdApi }
  | {
      type: 'EXECUTE_ORCHESTRATION_SCENARIO';
      scenarioId: DgxOrchestrationScenarioIdApi;
      planFingerprint: string;
      confirmed: true;
    };

export type DgxResourceActionResult = {
  ok: true;
  message: string;
  scenarioPreview?: ScenarioPlanPreviewApi;
  scenarioExecute?: DgxResourceScenarioExecuteResultApi;
};
