/** API の DgxPolicyMode と同一キー（表示は dgxResourceProfiles で定義） */
export type DgxPolicyModeApi = 'business_first' | 'private_ok' | 'experiment_first';

export type DgxControlTargetIdApi =
  | 'system-prod-gateway'
  | 'system-prod-inference'
  | 'system-prod-embedding'
  | 'private-comfyui'
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
  };
  targets?: DgxControlTargetSnapshotApi[];
  sparkHost: DgxSparkHostOverview;
  /** @deprecated 後方互換。表示は targets を優先 */
  services: DgxResourceServiceCard[];
  notes: string[];
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
  | { type: 'SET_POLICY'; policyMode: DgxPolicyModeApi }
  | {
      type: 'EXECUTE_TARGET_ACTION';
      targetId: DgxControlTargetIdApi;
      action: 'start' | 'stop';
      reason?: string;
    };

export type DgxResourceActionResult = {
  ok: true;
  message: string;
};
