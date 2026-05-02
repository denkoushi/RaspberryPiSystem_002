import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

import {
  comfyPolicyBadgeApplicable,
  isBusinessFirstSuppressionHintActive,
  policyLabelJa,
  setPolicyEventMessage,
} from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourceEvent, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';

import type { LocalLlmGateway, LocalLlmRuntimeConfig, LocalLlmStatus } from '../local-llm-proxy.service.js';

export type DgxResourceKpis = {
  gpuUtilPct: number | null;
  unifiedMemoryUsedGiB: number | null;
  unifiedMemoryTotalGiB: number | null;
  freeMemoryGiB: number | null;
  /** グラフ配色などはこちらで分岐（表示ラベル文字列依存を避ける） */
  policyMode: DgxPolicyMode;
  policyLabel: string;
};

export type DgxServiceStatusKind = 'running' | 'degraded' | 'stopped' | 'unknown';

export type DgxSparkHostOverview = {
  configured: boolean;
  probedAt: string;
  status: DgxServiceStatusKind;
  probeUrl?: string;
  httpStatus?: number;
  errorBrief?: string;
};

export type DgxResourceServiceCard = {
  id: string;
  name: string;
  status: DgxServiceStatusKind;
  badges: string[];
  metaLines: string[];
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
    mode: DgxPolicyMode;
    /** ロールバック用。未切替または同一モード再設定のみのとき null */
    previousMode: DgxPolicyMode | null;
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
  sparkHost: DgxSparkHostOverview;
  services: DgxResourceServiceCard[];
  notes: string[];
};

export type DgxResourceActionBody =
  | { type: 'LOCAL_LLM_START'; reason?: string }
  | { type: 'LOCAL_LLM_STOP'; reason?: string }
  | { type: 'SET_POLICY'; policyMode: DgxPolicyMode };

export type DgxResourceServicePort = {
  getOverview: () => Promise<DgxResourceOverview>;
  executeAction: (body: DgxResourceActionBody) => Promise<{ ok: true; message: string }>;
  getEvents: (limit: number) => DgxResourceEvent[];
};

type MetricsPayload = {
  gpuUtilPct?: number;
  unifiedMemoryUsedGiB?: number;
  unifiedMemoryTotalGiB?: number;
  freeMemoryGiB?: number;
};

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

export type DgxResourceServiceDeps = {
  fetchImpl: typeof fetch;
  localLlmGateway: LocalLlmGateway;
  getAdminLocalLlmRuntimeConfig: () => LocalLlmRuntimeConfig;
  policyStore: DgxResourcePolicyStore;
  probeTimeoutMs: number;
  metricsUrl?: string;
  comfyHealthUrl?: string;
  embeddingHealthUrl?: string;
  /** DGX Spark ホスト疎通（任意） */
  sparkHostStatusUrl?: string;
};

async function fetchJsonMetrics(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<MetricsPayload | undefined> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', signal });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return undefined;
    const o = body as Record<string, unknown>;
    const toNum = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    return {
      gpuUtilPct: toNum(o.gpuUtilPct ?? o.gpu_util_pct),
      unifiedMemoryUsedGiB: toNum(o.unifiedMemoryUsedGiB ?? o.unified_memory_used_gib),
      unifiedMemoryTotalGiB: toNum(o.unifiedMemoryTotalGiB ?? o.unified_memory_total_gib),
      freeMemoryGiB: toNum(o.freeMemoryGiB ?? o.free_memory_gib),
    };
  } catch {
    return undefined;
  } finally {
    cleanup();
  }
}

async function probeHttpOk(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<boolean> {
  const r = await probeHttpGet(url, fetchImpl, timeoutMs, headers);
  return r.ok;
}

async function probeHttpGet(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<{ ok: boolean; statusCode?: number; errorBrief?: string }> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal });
    const ok = response.ok;
    const statusCode = response.status;
    return {
      ok,
      statusCode,
      ...(ok ? {} : { errorBrief: `HTTP ${statusCode}` }),
    };
  } catch (e: unknown) {
    const aborted = typeof e === 'object' && e != null && (e as { name?: string }).name === 'AbortError';
    return { ok: false, errorBrief: aborted ? 'timeout_or_abort' : 'network_or_error' };
  } finally {
    cleanup();
  }
}

async function probeV1Models(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<{ ok: boolean; statusCode?: number }> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const url = new URL('/v1/models', baseUrl);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-LLM-Token': token },
      signal,
    });
    return { ok: response.ok, statusCode: response.status };
  } catch {
    return { ok: false };
  } finally {
    cleanup();
  }
}

function buildWarmWindow(): DgxResourceWarmWindow {
  if (!env.LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED) {
    return { enabled: false };
  }
  return {
    enabled: true,
    timeZone: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE,
    startHourInclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR,
    endHourExclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR,
  };
}

function comfyMetaLines(policyMode: DgxPolicyMode, comfyConfigured: boolean, comfyProbeUrl?: string): string[] {
  const lines: string[] = [];
  if (comfyConfigured && comfyProbeUrl) lines.push(`probe: GET ${comfyProbeUrl}`);
  if (isBusinessFirstSuppressionHintActive(policyMode)) {
    lines.push('業務優先: 私用GPU負荷は運用手順で抑制');
  }
  if (policyMode === 'experiment_first') {
    lines.push('実験優先: 業務 Inference との競合は人手で確認（Runbook）');
  }
  return lines;
}

export function createDgxResourceService(deps: DgxResourceServiceDeps): DgxResourceServicePort {
  const postRuntimeControl = async (
    targetUrl: string,
    timeoutMs: number,
    reason?: string
  ): Promise<void> => {
    const token =
      env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || env.LOCAL_LLM_SHARED_TOKEN?.trim() || '';
    if (!token) {
      throw new ApiError(503, 'ランタイム制御トークンが未設定です', undefined, 'DGX_RUNTIME_TOKEN_MISSING');
    }
    const { signal, cleanup } = createTimeoutSignal(timeoutMs);
    try {
      const response = await deps.fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Control-Token': token,
        },
        body: JSON.stringify({ reason: reason ?? 'dgx_resource_ui' }),
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ApiError(
          502,
          'DGX 側のランタイム制御が拒否または失敗しました',
          { httpStatus: response.status, body: text.slice(0, 500) },
          'DGX_RUNTIME_CONTROL_FAILED'
        );
      }
      await response.text().catch(() => '');
    } finally {
      cleanup();
    }
  };

  const handleSetPolicy = (mode: DgxPolicyMode): { ok: true; message: string } => {
    const changed = deps.policyStore.setPolicyMode(mode);
    if (!changed) {
      return { ok: true, message: `${policyLabelJa(mode)}モードのままです` };
    }
    const msg = setPolicyEventMessage(mode);
    deps.policyStore.appendEvent(msg);
    return { ok: true, message: msg };
  };

  const handleRuntimeAction = async (body: Extract<DgxResourceActionBody, { type: 'LOCAL_LLM_START' } | { type: 'LOCAL_LLM_STOP' }>): Promise<{ ok: true; message: string }> => {
    const startUrl = env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim();
    const stopUrl = env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim();
    const runtimeConfigured = Boolean(startUrl && stopUrl);
    if (!runtimeConfigured || env.LOCAL_LLM_RUNTIME_MODE !== 'on_demand') {
      throw new ApiError(
        400,
        'LocalLLM が on_demand かつ 起動/停止 URL が設定されているときのみ操作できます',
        { mode: env.LOCAL_LLM_RUNTIME_MODE, runtimeConfigured },
        'DGX_RUNTIME_CONTROL_NOT_CONFIGURED'
      );
    }

    if (body.type === 'LOCAL_LLM_START') {
      await postRuntimeControl(startUrl!, env.LOCAL_LLM_RUNTIME_START_REQUEST_TIMEOUT_MS, body.reason);
      deps.policyStore.appendEvent('LocalLLM ランタイム起動を要求しました');
      return { ok: true, message: '起動リクエストを送信しました（反映まで時間がかかる場合があります）' };
    }

    await postRuntimeControl(stopUrl!, env.LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS, body.reason);
    deps.policyStore.appendEvent('LocalLLM ランタイム停止を要求しました');
    return { ok: true, message: '停止リクエストを送信しました' };
  };

  return {
    getEvents(limit: number): DgxResourceEvent[] {
      return deps.policyStore.getEvents(limit);
    },

    async executeAction(body: DgxResourceActionBody): Promise<{ ok: true; message: string }> {
      if (body.type === 'SET_POLICY') return handleSetPolicy(body.policyMode);
      return handleRuntimeAction(body);
    },

    async getOverview(): Promise<DgxResourceOverview> {
      const generatedAt = new Date().toISOString();
      const policyMode = deps.policyStore.getPolicyMode();
      const previousMode = deps.policyStore.getPreviousPolicyMode();

      const adminCfg = deps.getAdminLocalLlmRuntimeConfig();
      const status: LocalLlmStatus = await deps.localLlmGateway.getStatus();

      let modelsProbe: { ok: boolean; statusCode?: number } = { ok: false };
      if (
        status.configured &&
        adminCfg.configured &&
        adminCfg.baseUrl &&
        adminCfg.sharedToken &&
        status.health.ok
      ) {
        modelsProbe = await probeV1Models(
          adminCfg.baseUrl,
          adminCfg.sharedToken,
          deps.fetchImpl,
          deps.probeTimeoutMs
        );
      }

      const metricsConfigured = Boolean(deps.metricsUrl?.trim());
      const metricsPayload = metricsConfigured
        ? await fetchJsonMetrics(deps.metricsUrl!, deps.fetchImpl, deps.probeTimeoutMs)
        : undefined;

      const comfyConfigured = Boolean(deps.comfyHealthUrl?.trim());
      let comfyReachable = false;
      if (comfyConfigured) {
        comfyReachable = await probeHttpOk(deps.comfyHealthUrl!, deps.fetchImpl, deps.probeTimeoutMs);
      }

      const embeddingConfigured = Boolean(deps.embeddingHealthUrl?.trim());
      let embeddingReachable = false;
      if (embeddingConfigured && adminCfg.sharedToken && adminCfg.baseUrl) {
        const raw = deps.embeddingHealthUrl!;
        const embUrl =
          raw.startsWith('http://') || raw.startsWith('https://')
            ? raw
            : new URL(raw, adminCfg.baseUrl).toString();
        embeddingReachable = await probeHttpOk(embUrl, deps.fetchImpl, deps.probeTimeoutMs, {
          'X-LLM-Token': adminCfg.sharedToken,
        });
      }

      const sparkUrl = deps.sparkHostStatusUrl?.trim();
      const sparkConfigured = Boolean(sparkUrl);
      let sparkProbe: { ok: boolean; statusCode?: number; errorBrief?: string } = { ok: false };
      if (sparkConfigured) {
        sparkProbe = await probeHttpGet(sparkUrl!, deps.fetchImpl, deps.probeTimeoutMs);
      }

      const gatewayStatus: DgxServiceStatusKind = status.configured
        ? status.health.ok
          ? 'running'
          : 'stopped'
        : 'unknown';
      const inferenceStatus: DgxServiceStatusKind = modelsProbe.ok
        ? 'running'
        : status.health.ok && status.configured
          ? 'degraded'
          : status.configured
            ? 'stopped'
            : 'unknown';

      let comfyUiStatus: DgxServiceStatusKind = 'unknown';
      if (comfyConfigured) {
        comfyUiStatus = comfyReachable ? 'running' : 'stopped';
      }

      const comfyBadges =
        comfyPolicyBadgeApplicable(policyMode, comfyConfigured, comfyReachable) ? ['policy'] : [];

      const embeddingStatus: DgxServiceStatusKind = !embeddingConfigured
        ? 'unknown'
        : embeddingReachable
          ? 'running'
          : 'stopped';

      const notes: string[] = [];
      if (!metricsConfigured) {
        notes.push('GPU/メモリKPI は DGX_RESOURCE_METRICS_URL が未設定のため取得していません');
      }
      if (!comfyConfigured) {
        notes.push(
          'ComfyUI は DGX_RESOURCE_COMFYUI_HEALTH_URL 未設定のため疎通のみ表示できません（SSH ポートフォワード運用は Runbook 参照）'
        );
      }
      if (!sparkConfigured) {
        notes.push(
          'DGX Spark ホスト簡易監視は DGX_RESOURCE_SPARK_HOST_STATUS_URL 未設定のため未取得です（メトリクス sidecar の /health 等を Runbook で設定）'
        );
      }

      const services: DgxResourceServiceCard[] = [
        {
          id: 'system-prod-gateway',
          name: 'system-prod-gateway',
          status: gatewayStatus,
          badges: [],
          metaLines: [
            ...(adminCfg.baseUrl ? [`gateway: ${adminCfg.baseUrl}`] : []),
            ...(status.health.statusCode !== undefined ? [`health HTTP ${status.health.statusCode}`] : []),
          ],
        },
        {
          id: 'system-prod-inference',
          name: 'inference-backend (/v1/models)',
          status: inferenceStatus,
          badges: modelsProbe.ok ? [] : inferenceStatus === 'degraded' ? ['degraded'] : [],
          metaLines: [
            ...(modelsProbe.statusCode !== undefined ? [`/v1/models → ${modelsProbe.statusCode}`] : []),
            ...(adminCfg.model ? [`model hint: ${adminCfg.model}`] : []),
          ],
        },
        {
          id: 'private-comfyui',
          name: 'private-comfyui',
          status: comfyUiStatus,
          badges: comfyBadges,
          metaLines: comfyMetaLines(policyMode, comfyConfigured, deps.comfyHealthUrl ?? undefined),
        },
        {
          id: 'system-prod-embedding',
          name: 'system-prod-embedding',
          status: embeddingStatus,
          badges: [],
          metaLines:
            embeddingConfigured && deps.embeddingHealthUrl ? [`probe: ${deps.embeddingHealthUrl}`] : [],
        },
      ];

      const runtimeControlConfigured =
        Boolean(env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim() && env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim()) &&
        env.LOCAL_LLM_RUNTIME_MODE === 'on_demand';

      const sparkHost: DgxSparkHostOverview = {
        configured: sparkConfigured,
        probedAt: generatedAt,
        status: sparkConfigured ? (sparkProbe.ok ? 'running' : 'stopped') : 'unknown',
        ...(sparkConfigured && sparkUrl ? { probeUrl: sparkUrl } : {}),
        ...(sparkProbe.statusCode !== undefined ? { httpStatus: sparkProbe.statusCode } : {}),
        ...(sparkProbe.errorBrief && !sparkProbe.ok ? { errorBrief: sparkProbe.errorBrief } : {}),
      };

      return {
        generatedAt,
        kpis: {
          gpuUtilPct: metricsPayload?.gpuUtilPct ?? null,
          unifiedMemoryUsedGiB: metricsPayload?.unifiedMemoryUsedGiB ?? null,
          unifiedMemoryTotalGiB: metricsPayload?.unifiedMemoryTotalGiB ?? null,
          freeMemoryGiB: metricsPayload?.freeMemoryGiB ?? null,
          policyMode,
          policyLabel: policyLabelJa(policyMode),
        },
        policy: {
          mode: policyMode,
          previousMode,
          comfyStartBlockedHint: isBusinessFirstSuppressionHintActive(policyMode),
        },
        runtime: {
          localLlmMode: env.LOCAL_LLM_RUNTIME_MODE,
          runtimeControlConfigured,
          warmWindow: buildWarmWindow(),
        },
        optionalProbes: {
          metricsConfigured,
          comfyHealthConfigured: comfyConfigured,
          embeddingHealthConfigured: embeddingConfigured,
          sparkHostConfigured: sparkConfigured,
        },
        sparkHost,
        services,
        notes,
      };
    },
  };
}
