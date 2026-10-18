export type DgxResourceEvent = { id: string; at: string; message: string };
export type DgxResourceEventsResponse = { events: DgxResourceEvent[] };
export type DgxBusinessReturn = {
  state: 'idle' | 'in_progress' | 'succeeded' | 'failed';
  phase: 'starting' | 'checking' | null;
  profileId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failureReasonJa: string | null;
};
type ProfileLabel = { id: string; displayName: string };
export type DgxResourceOverview = {
  generatedAt: string;
  business: {
    state: 'ready' | 'ready_mismatch' | 'degraded' | 'down' | 'unconfigured' | 'returning';
    llm: { state: 'ok' | 'down' | 'unconfigured' };
    embedding: {
      state: 'ok' | 'failed' | 'not_observed' | 'disabled';
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      lastErrorBrief: string | null;
    };
    activeProfile: ProfileLabel | null;
    intendedProfile: ProfileLabel | null;
    matchesIntent: boolean | null;
  };
  metrics: {
    gpuName: string | null;
    modelMemBytes: number | null;
    otherMemBytes: number | null;
    unifiedMemUsedBytes: number | null;
    unifiedMemTotalBytes: number | null;
    gpuUtilPct: number | null;
    temperatureC: number | null;
    powerW: number | null;
  };
  modelProfiles: Array<ProfileLabel & {
    backendLabel: 'vLLM' | 'llama.cpp' | '不明';
    quantizationLabel: string | null;
    requiredBytes: number | null;
    fitAvailableBytes: number | null;
    censored: boolean;
    unavailableKind: 'no_storage' | 'disabled' | 'insufficient_memory' | null;
    supportsVision: boolean;
    isActive: boolean;
    isRecommended: boolean;
    startupFit: 'fits' | 'insufficient' | 'unknown';
    startable: boolean;
    unavailableReasonJa: string | null;
    deletable: boolean;
    storageBytes?: number;
  }>;
  modelProfilesAvailable: boolean;
  businessReturn: DgxBusinessReturn;
  alerts: Array<{ id: string; messageJa: string }>;
};
export type DgxResourceActionBody =
  | { type: 'RETURN_TO_BUSINESS'; modelProfileId: string }
  | { type: 'STOP_BUSINESS_LLM' }
  | { type: 'PREVIEW_MODEL_STORAGE_DELETE'; modelProfileId: string }
  | { type: 'EXECUTE_MODEL_STORAGE_DELETE'; modelProfileId: string; planFingerprint: string; confirmation: string };
export type DgxModelStorageDeletePreview = {
  ok: true;
  modelProfileId: string;
  displayNameJa: string;
  canDelete: boolean;
  blockedReasons: Array<{ code: string; detailJa: string }>;
  storagePath: string | null;
  resolvedStoragePath: string | null;
  requiredConfirmation: string;
  planFingerprint: string | null;
  sizeBytes?: number;
  sizeGiB?: number;
  fileCount?: number;
  directoryCount?: number;
};

export type DgxModelStorageDeleteExecuteResult = {
  ok: true;
  modelProfileId: string;
  displayNameJa: string;
  deletedStoragePath: string;
  sizeBytes?: number | null;
  sizeGiB?: number | null;
  fileCount?: number | null;
  directoryCount?: number | null;
};

export type DgxResourceActionResult = {
  ok: true;
  message: string;
  businessReturn?: DgxBusinessReturn;
  modelStorageDeletePreview?: DgxModelStorageDeletePreview;
  modelStorageDeleteExecute?: DgxModelStorageDeleteExecuteResult;
};
