import { ApiError } from '../../../lib/errors.js';

import { createTimeoutSignal } from './dgx-resource.probes.js';

export type DgxBusinessModelProfile = {
  id: string;
  displayNameJa: string;
  backend: 'green' | 'blue';
  servedAlias: string;
  recommended: boolean;
  enabled: boolean;
  status: 'available' | 'unavailable' | 'unknown';
  descriptionJa?: string;
  sourceModelRef?: string;
  sourceKind?: string;
  storageLocation?: string;
  currentStorageLocation?: string;
  storageStatus?: string;
  modelFamily?: string;
  format?: string;
  quantization?: string;
  expectedSizeGb?: number;
  expectedColdStartSec?: number;
  canonicalNames: string[];
  legacyNames: string[];
  unavailableReasonJa?: string;
  declaredCapabilities?: string[];
  visionRequiresMmproj?: boolean;
  launcherHints?: Record<string, string>;
};

export type DgxModelProfilesOverview = {
  configured: boolean;
  status: 'ok' | 'degraded' | 'unconfigured';
  available: DgxBusinessModelProfile[];
  activeProfileId: string | null;
  /** DGX `GET /system/model-profiles` の `state.backend`（state 未作成時は null） */
  activeStateBackend: 'green' | 'blue' | null;
  pendingProfileId: string | null;
  lastLoadedProfileId: string | null;
  errorMessageJa?: string;
};

export const BUSINESS_RETURN_SCENARIO_IDS = new Set(['private_to_business', 'experiment_to_business']);

type GatewayModelProfilesResponse = {
  ok?: boolean;
  profiles?: unknown;
  activeProfileId?: unknown;
  state?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

const parseActiveStateBackend = (state: unknown): 'green' | 'blue' | null => {
  if (!isRecord(state)) return null;
  const backend = asString(state.backend);
  return backend === 'green' || backend === 'blue' ? backend : null;
};

export function normalizeDgxModelProfile(value: unknown): DgxBusinessModelProfile | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const displayNameJa = asString(value.displayNameJa);
  const backend = asString(value.backend);
  const servedAlias = asString(value.servedAlias) ?? 'system-prod-primary';
  if (!id || !displayNameJa || (backend !== 'green' && backend !== 'blue')) return null;
  const status = asString(value.status);
  return {
    id,
    displayNameJa,
    backend,
    servedAlias,
    recommended: value.recommended === true,
    enabled: value.enabled !== false,
    status: status === 'available' || status === 'unavailable' ? status : 'unknown',
    ...(asString(value.descriptionJa) ? { descriptionJa: asString(value.descriptionJa)! } : {}),
    ...(asString(value.sourceModelRef) ? { sourceModelRef: asString(value.sourceModelRef)! } : {}),
    ...(asString(value.sourceKind) ? { sourceKind: asString(value.sourceKind)! } : {}),
    ...(asString(value.storageLocation) ? { storageLocation: asString(value.storageLocation)! } : {}),
    ...(asString(value.currentStorageLocation) ? { currentStorageLocation: asString(value.currentStorageLocation)! } : {}),
    ...(asString(value.storageStatus) ? { storageStatus: asString(value.storageStatus)! } : {}),
    ...(asString(value.modelFamily) ? { modelFamily: asString(value.modelFamily)! } : {}),
    ...(asString(value.format) ? { format: asString(value.format)! } : {}),
    ...(asString(value.quantization) ? { quantization: asString(value.quantization)! } : {}),
    ...(asNumber(value.expectedSizeGb) !== undefined ? { expectedSizeGb: asNumber(value.expectedSizeGb)! } : {}),
    ...(asNumber(value.expectedColdStartSec) !== undefined ? { expectedColdStartSec: asNumber(value.expectedColdStartSec)! } : {}),
    canonicalNames: asStringArray(value.canonicalNames),
    legacyNames: asStringArray(value.legacyNames),
    ...(asString(value.unavailableReasonJa) ? { unavailableReasonJa: asString(value.unavailableReasonJa)! } : {}),
    ...(asStringArray(value.declaredCapabilities).length > 0
      ? { declaredCapabilities: asStringArray(value.declaredCapabilities) }
      : {}),
    ...(value.visionRequiresMmproj === true ? { visionRequiresMmproj: true } : {}),
    ...(isRecord(value.launcherHints)
      ? {
          launcherHints: Object.fromEntries(
            Object.entries(value.launcherHints).filter(([, v]) => typeof v === 'string' && v.trim())
          ) as Record<string, string>,
        }
      : {}),
  };
}

export function modelProfileSelectionAllowed(scenarioId: string): boolean {
  return BUSINESS_RETURN_SCENARIO_IDS.has(scenarioId);
}

export function assertModelProfileSelectionAllowed(scenarioId: string, modelProfileId?: string): void {
  if (modelProfileId && !modelProfileSelectionAllowed(scenarioId)) {
    throw new ApiError(
      400,
      'modelProfileId は私用/実験から業務へ戻すシナリオでのみ指定できます',
      { scenarioId, modelProfileId },
      'DGX_MODEL_PROFILE_NOT_ALLOWED_FOR_SCENARIO'
    );
  }
}

export function assertModelProfileKnownAndStartable(
  modelProfiles: DgxModelProfilesOverview,
  modelProfileId: string
): DgxBusinessModelProfile {
  if (modelProfiles.status !== 'ok') {
    throw new ApiError(
      503,
      modelProfiles.errorMessageJa ?? 'DGX model profiles API が利用できないためモデルを選択できません',
      { modelProfileId, modelProfilesStatus: modelProfiles.status },
      'DGX_MODEL_PROFILES_UNAVAILABLE'
    );
  }
  const profile = modelProfiles.available.find((p) => p.id === modelProfileId);
  if (!profile) {
    throw new ApiError(
      400,
      '未知の modelProfileId です。DGX の model profiles allowlist を確認してください',
      { modelProfileId },
      'DGX_MODEL_PROFILE_UNKNOWN'
    );
  }
  if (!profile.enabled || profile.status === 'unavailable') {
    throw new ApiError(
      409,
      profile.unavailableReasonJa ?? '指定された modelProfileId は現在利用できません',
      { modelProfileId, enabled: profile.enabled, status: profile.status },
      'DGX_MODEL_PROFILE_UNAVAILABLE'
    );
  }
  return profile;
}

export async function fetchDgxModelProfilesOverview(input: {
  baseUrl?: string;
  sharedToken?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<DgxModelProfilesOverview> {
  if (!input.baseUrl || !input.sharedToken) {
    return {
      configured: false,
      status: 'unconfigured',
      available: [],
      activeProfileId: null,
      activeStateBackend: null,
      pendingProfileId: null,
      lastLoadedProfileId: null,
      errorMessageJa: 'DGX gateway の baseUrl または共有トークンが未設定です',
    };
  }
  const { signal, cleanup } = createTimeoutSignal(input.timeoutMs);
  try {
    const url = new URL('/system/model-profiles', input.baseUrl);
    const response = await input.fetchImpl(url, {
      method: 'GET',
      headers: { 'X-LLM-Token': input.sharedToken },
      signal,
    });
    if (!response.ok) {
      return {
        configured: true,
        status: 'degraded',
        available: [],
        activeProfileId: null,
        activeStateBackend: null,
        pendingProfileId: null,
        lastLoadedProfileId: null,
        errorMessageJa: `DGX model profiles API が HTTP ${response.status} を返しました`,
      };
    }
    const body = (await response.json()) as GatewayModelProfilesResponse;
    const profiles = Array.isArray(body.profiles)
      ? body.profiles.map(normalizeDgxModelProfile).filter((p): p is DgxBusinessModelProfile => p !== null)
      : [];
    const activeProfileId = asString(body.activeProfileId) ?? null;
    const activeStateBackend = parseActiveStateBackend(body.state);
    // Allowlist fetch succeeded: activeProfileId may be null before first profile-scoped /start (DGX contract).
    return {
      configured: true,
      status: 'ok',
      available: profiles,
      activeProfileId,
      activeStateBackend,
      pendingProfileId: null,
      lastLoadedProfileId: activeProfileId,
    };
  } catch {
    return {
      configured: true,
      status: 'degraded',
      available: [],
      activeProfileId: null,
      activeStateBackend: null,
      pendingProfileId: null,
      lastLoadedProfileId: null,
      errorMessageJa: 'DGX model profiles API に接続できませんでした',
    };
  } finally {
    cleanup();
  }
}
