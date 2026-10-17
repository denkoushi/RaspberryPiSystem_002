import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { resolveBusinessRuntimeStartProfile } from '../../inference/config/business-profile-intent.js';
import { getBusinessProfileIntentStore } from '../../inference/config/business-profile-intent-store.js';
import { readPhotoToolEmbeddingHealth } from '../../tools/photo-tool-label/photo-tool-embedding-health.js';

import { executeGatewayRuntimeStartStop } from './dgx-resource.gateway-runtime.executor.js';
import { fetchDgxModelProfilesOverview, profileDeclaresVision, type DgxBusinessModelProfile } from './dgx-resource.model-profiles.js';
import {
  executeDgxModelStorageDelete, previewDgxModelStorageDelete,
  type DgxModelStorageDeleteExecuteResult, type DgxModelStorageDeletePreview,
} from './dgx-resource.model-storage-delete.js';
import { fetchJsonMetrics, probeV1Models } from './dgx-resource.probes.js';
import { waitBusinessReadiness, type BusinessReadinessSnapshot } from './dgx-resource.scenario-readiness.js';
import { enrichDgxModelProfilesStartupFit } from './dgx-resource.startup-fit.js';
import type { BusinessReturn, DgxResourceEvent, DgxResourceStateStore } from './dgx-resource.state-store.js';

import type { LocalLlmGateway, LocalLlmRuntimeConfig } from '../local-llm-proxy.service.js';

type ProfileLabel = { id: string; displayName: string };
export type DgxResourceOverview = {
  generatedAt: string;
  business: {
    state: 'ready' | 'ready_mismatch' | 'degraded' | 'down' | 'unconfigured' | 'returning';
    llm: { state: BusinessReadinessSnapshot['llmState'] };
    embedding: ReturnType<typeof readPhotoToolEmbeddingHealth>;
    activeProfile: ProfileLabel | null;
    intendedProfile: ProfileLabel | null;
    matchesIntent: boolean | null;
  };
  metrics: {
    unifiedMemUsedBytes: number | null;
    unifiedMemTotalBytes: number | null;
    gpuUtilPct: number | null;
    temperatureC: number | null;
    powerW: number | null;
  };
  modelProfiles: Array<ProfileLabel & {
    backendLabel: 'vLLM' | 'llama.cpp' | '不明';
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
  businessReturn: BusinessReturn;
  alerts: Array<{ id: string; messageJa: string }>;
};

export type DgxResourceActionBody =
  | { type: 'RETURN_TO_BUSINESS'; modelProfileId: string }
  | { type: 'STOP_BUSINESS_LLM' }
  | { type: 'PREVIEW_MODEL_STORAGE_DELETE'; modelProfileId: string }
  | { type: 'EXECUTE_MODEL_STORAGE_DELETE'; modelProfileId: string; planFingerprint: string; confirmation: string };

export type DgxResourceActionResult = {
  ok: true;
  message: string;
  businessReturn?: BusinessReturn;
  modelStorageDeletePreview?: DgxModelStorageDeletePreview;
  modelStorageDeleteExecute?: DgxModelStorageDeleteExecuteResult;
};

export type DgxResourceServicePort = {
  getOverview: () => Promise<DgxResourceOverview>;
  executeAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  getEvents: (limit: number) => DgxResourceEvent[];
};

export type DgxResourceServiceDeps = {
  fetchImpl: typeof fetch;
  localLlmGateway: LocalLlmGateway;
  getAdminLocalLlmRuntimeConfig: () => LocalLlmRuntimeConfig;
  stateStore: DgxResourceStateStore;
  probeTimeoutMs: number;
  metricsUrl?: string;
};

function displayName(profile: DgxBusinessModelProfile): string {
  return profile.displayNameJa !== profile.id ? profile.displayNameJa : '名称未登録のモデル';
}

function unavailableReason(profile: DgxBusinessModelProfile): string | null {
  if (!profile.businessOrchestrationEligible) return '業務用ではありません';
  if (!profile.enabled || profile.status !== 'available') return '現在は利用できません';
  if (profile.startupFit?.status === 'insufficient') return 'メモリ不足';
  return null;
}

export function createDgxResourceService(deps: DgxResourceServiceDeps): DgxResourceServicePort {
  const store = deps.stateStore;
  const fetchProfiles = () => {
    const config = deps.getAdminLocalLlmRuntimeConfig();
    return fetchDgxModelProfilesOverview({
      baseUrl: config.baseUrl, sharedToken: config.sharedToken,
      fetchImpl: deps.fetchImpl, timeoutMs: deps.probeTimeoutMs,
    });
  };
  const fetchMetrics = async () => {
    const config = deps.getAdminLocalLlmRuntimeConfig();
    const candidates = deps.metricsUrl?.trim()
      ? [{ url: deps.metricsUrl, headers: undefined }]
      : config.baseUrl
        ? ['/system/metrics', '/v1/system/metrics'].map((path) => ({
          url: new URL(path, config.baseUrl).toString(),
          headers: config.sharedToken ? { 'X-LLM-Token': config.sharedToken } : undefined,
        })) : [];
    for (const candidate of candidates) {
      const metrics = await fetchJsonMetrics(candidate.url, deps.fetchImpl, deps.probeTimeoutMs, candidate.headers);
      if (metrics) return metrics;
    }
    return undefined;
  };
  const collect = async (): Promise<BusinessReadinessSnapshot> => {
    const config = deps.getAdminLocalLlmRuntimeConfig();
    const [gateway, profiles, models] = await Promise.all([
      deps.localLlmGateway.getStatus(), fetchProfiles(),
      config.configured && config.baseUrl && config.sharedToken
        ? probeV1Models(config.baseUrl, config.sharedToken, deps.fetchImpl, deps.probeTimeoutMs)
        : Promise.resolve({ ok: false }),
    ]);
    return {
      llmState: !gateway.configured ? 'unconfigured' : gateway.health.ok && models.ok ? 'ok' : 'down',
      modelProfiles: profiles,
    };
  };
  const acquire = () => {
    if (!store.tryAcquire()) {
      throw new ApiError(409, '別の操作が進行中です。終わるまでお待ちください。', undefined, 'DGX_OPERATION_IN_PROGRESS');
    }
  };
  const finishReturn = async (profile: DgxBusinessModelProfile) => {
    try {
      await executeGatewayRuntimeStartStop(deps, 'start', 'return_to_business', profile.id);
      const ready = await waitBusinessReadiness({
        collect, modelProfileId: profile.id,
        timeoutMs: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
        pollIntervalMs: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
        retryStart: () => executeGatewayRuntimeStartStop(deps, 'start', 'return_to_business_retry', profile.id),
      });
      if (!ready) {
        const reason = 'モデルの準備が時間内に終わりませんでした。状態を確認して、もう一度お試しください。';
        store.finishReturn(reason);
        store.appendEvent(`業務に戻せませんでした。${reason}`);
        return;
      }
      getBusinessProfileIntentStore().setFromOrchestration(profile.id);
      store.finishReturn(null);
      store.appendEvent(`「${displayName(profile)}」で業務に戻しました。`);
    } catch {
      const reason = 'モデルを読み込めませんでした。DGX との接続や設定を確認して、もう一度お試しください。';
      store.finishReturn(reason);
      store.appendEvent(`業務に戻せませんでした。${reason}`);
    } finally {
      store.release();
    }
  };

  return {
    getEvents: (limit) => store.getEvents(limit),
    async getOverview() {
      const [snapshot, metrics] = await Promise.all([collect(), fetchMetrics()]);
      const profiles = enrichDgxModelProfilesStartupFit(snapshot.modelProfiles, metrics);
      const intendedId = resolveBusinessRuntimeStartProfile({
        businessRuntimeStartProfileId: env.INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID,
      })?.modelProfileId;
      const label = (id: string | null | undefined): ProfileLabel | null => {
        if (!id) return null;
        const profile = profiles.available.find((item) => item.id === id);
        return { id, displayName: profile ? displayName(profile) : '名称を確認できないモデル' };
      };
      const activeProfile = label(profiles.activeProfileId);
      const intendedProfile = label(intendedId);
      const matchesIntent = intendedId ? profiles.activeProfileId === intendedId : null;
      const embedding = readPhotoToolEmbeddingHealth();
      const businessReturn = store.getBusinessReturn();
      const state: DgxResourceOverview['business']['state'] = businessReturn.state === 'in_progress' ? 'returning'
        : snapshot.llmState === 'unconfigured' ? 'unconfigured'
          : snapshot.llmState === 'down' ? 'down'
            : embedding.state === 'failed' ? 'degraded'
              : matchesIntent === false ? 'ready_mismatch' : 'ready';
      const alerts: DgxResourceOverview['alerts'] = [];
      if (matchesIntent === false && state !== 'returning') {
        alerts.push({ id: 'model_mismatch', messageJa: `業務で使うモデル（${intendedProfile!.displayName}）と動いているモデル（${activeProfile?.displayName ?? 'なし'}）が違います。揃えるには「このモデルで業務に戻す」を押してください。` });
      }
      if (state === 'down') {
        alerts.push({ id: 'llm_down', messageJa: 'DGX の業務 LLM が応答しません。「このモデルで業務に戻す」で起動してください。' });
      }
      if (businessReturn.state === 'failed') {
        alerts.push({ id: 'return_failed', messageJa: `直近の業務復帰に失敗しました。${businessReturn.failureReasonJa}` });
      }
      return {
        generatedAt: new Date().toISOString(),
        business: { state, llm: { state: snapshot.llmState }, embedding, activeProfile, intendedProfile, matchesIntent },
        metrics: {
          unifiedMemUsedBytes: metrics?.unifiedMemoryUsedGiB != null ? metrics.unifiedMemoryUsedGiB * 1024 ** 3 : null,
          unifiedMemTotalBytes: metrics?.unifiedMemoryTotalGiB != null ? metrics.unifiedMemoryTotalGiB * 1024 ** 3 : null,
          gpuUtilPct: metrics?.gpuUtilPct ?? null, temperatureC: metrics?.gpuTemperatureC ?? null,
          powerW: metrics?.gpuPowerDrawW ?? null,
        },
        modelProfiles: profiles.available.filter((profile) => profile.businessOrchestrationEligible).map((profile) => ({
          id: profile.id, displayName: displayName(profile),
          backendLabel: profile.runtimeProfile?.engine === 'vllm' ? 'vLLM' as const
            : profile.runtimeProfile?.engine === 'llama.cpp' ? 'llama.cpp' as const : '不明' as const,
          supportsVision: profileDeclaresVision(profile), isActive: profiles.activeProfileId === profile.id,
          isRecommended: profile.recommended,
          startupFit: profile.startupFit?.status === 'fits' ? 'fits' as const
            : profile.startupFit?.status === 'insufficient' ? 'insufficient' as const : 'unknown' as const,
          startable: unavailableReason(profile) === null, unavailableReasonJa: unavailableReason(profile),
          deletable: profile.deleteProtection?.canDelete === true && !profile.deleteProtection.protected && profiles.activeProfileId !== profile.id,
        })),
        modelProfilesAvailable: profiles.status === 'ok', businessReturn, alerts,
      };
    },
    async executeAction(body) {
      acquire();
      let backgroundOwnsLock = false;
      try {
        if (body.type === 'RETURN_TO_BUSINESS') {
          const [catalog, metrics] = await Promise.all([fetchProfiles(), fetchMetrics()]);
          const profiles = enrichDgxModelProfilesStartupFit(catalog, metrics);
          if (profiles.status !== 'ok') {
            throw new ApiError(503, 'モデル一覧を取得できません。少し待ってお試しください。', undefined, 'DGX_MODEL_PROFILES_UNAVAILABLE');
          }
          const profile = profiles.available.find((item) => item.id === body.modelProfileId);
          if (!profile) throw new ApiError(400, '選んだモデルが見つかりません。', undefined, 'DGX_MODEL_PROFILE_UNKNOWN');
          const reason = unavailableReason(profile);
          if (reason) throw new ApiError(409, `このモデルは起動できません（${reason}）。`, undefined, 'DGX_MODEL_PROFILE_UNAVAILABLE');
          const businessReturn = store.startReturn(profile.id);
          store.appendEvent(`「${displayName(profile)}」を読み込み、業務に戻しています。`);
          backgroundOwnsLock = true;
          void finishReturn(profile);
          return { ok: true, message: '業務に戻しています。', businessReturn };
        }
        if (body.type === 'STOP_BUSINESS_LLM') {
          store.appendEvent('業務 LLM を止めています。');
          await executeGatewayRuntimeStartStop(deps, 'stop_force', 'stop_business_llm');
          store.appendEvent('業務 LLM を止めました。');
          return { ok: true, message: '業務 LLM を止めました。' };
        }
        const catalog = await fetchProfiles();
        if (catalog.status !== 'ok') throw new ApiError(503, 'モデル一覧を取得できません。', undefined, 'DGX_MODEL_PROFILES_UNAVAILABLE');
        const profile = catalog.available.find((item) => item.id === body.modelProfileId && item.businessOrchestrationEligible);
        if (!profile) throw new ApiError(400, '選んだ業務モデルが見つかりません。', undefined, 'DGX_MODEL_PROFILE_UNKNOWN');
        const options = {
          baseUrl: deps.getAdminLocalLlmRuntimeConfig().baseUrl, fetchImpl: deps.fetchImpl,
          timeoutMs: deps.probeTimeoutMs, modelProfileId: body.modelProfileId,
        };
        if (body.type === 'PREVIEW_MODEL_STORAGE_DELETE') {
          const preview = await previewDgxModelStorageDelete(options);
          store.appendEvent(`「${displayName(profile)}」の保存先を削除できるか確認しました。`);
          return { ok: true, message: '削除の確認ができました。', modelStorageDeletePreview: preview };
        }
        store.appendEvent(`「${displayName(profile)}」の保存先を削除しています。`);
        const result = await executeDgxModelStorageDelete({ ...options, planFingerprint: body.planFingerprint, confirmation: body.confirmation });
        store.appendEvent(`「${displayName(profile)}」の保存先を削除しました。`);
        return { ok: true, message: 'モデルの保存先を削除しました。', modelStorageDeleteExecute: result };
      } catch (error) {
        const message = body.type === 'RETURN_TO_BUSINESS' ? '業務に戻す操作を開始できませんでした。'
          : body.type === 'STOP_BUSINESS_LLM' ? '業務 LLM を止められませんでした。'
            : 'モデル保存先の操作を完了できませんでした。';
        store.appendEvent(message);
        throw error;
      } finally {
        if (!backgroundOwnsLock) store.release();
      }
    },
  };
}
