import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

import type { DgxPolicyMode, DgxResourceEvent, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';

import type { LocalLlmGateway, LocalLlmRuntimeConfig, LocalLlmStatus } from '../local-llm-proxy.service.js';

export type DgxResourceKpis = {
  gpuUtilPct: number | null;
  unifiedMemoryUsedGiB: number | null;
  unifiedMemoryTotalGiB: number | null;
  freeMemoryGiB: number | null;
  policyLabel: string;
};

export type DgxServiceStatusKind = 'running' | 'degraded' | 'stopped' | 'unknown';

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
  };
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

const policyLabelJa = (mode: DgxPolicyMode): string => (mode === 'business_first' ? '業務優先' : '私用OK');

export type DgxResourceServiceDeps = {
  fetchImpl: typeof fetch;
  localLlmGateway: LocalLlmGateway;
  getAdminLocalLlmRuntimeConfig: () => LocalLlmRuntimeConfig;
  policyStore: DgxResourcePolicyStore;
  probeTimeoutMs: number;
  metricsUrl?: string;
  comfyHealthUrl?: string;
  embeddingHealthUrl?: string;
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
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal });
    return response.ok;
  } catch {
    return false;
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

  return {
    getEvents(limit: number): DgxResourceEvent[] {
      return deps.policyStore.getEvents(limit);
    },

    async executeAction(body: DgxResourceActionBody): Promise<{ ok: true; message: string }> {
      if (body.type === 'SET_POLICY') {
        deps.policyStore.setPolicyMode(body.policyMode);
        const msg =
          body.policyMode === 'business_first' ? '業務優先モードに変更しました' : '私用OKモードに変更しました';
        deps.policyStore.appendEvent(msg);
        return { ok: true, message: msg };
      }

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
    },

    async getOverview(): Promise<DgxResourceOverview> {
      const generatedAt = new Date().toISOString();
      const policyMode = deps.policyStore.getPolicyMode();

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
        comfyConfigured && !comfyReachable && policyMode === 'business_first' ? ['policy'] : [];

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
          metaLines: [
            ...(comfyConfigured ? [`probe: GET ${deps.comfyHealthUrl}`] : []),
            ...(policyMode === 'business_first' ? ['業務優先: 私用GPU負荷は運用手順で抑制'] : []),
          ],
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

      return {
        generatedAt,
        kpis: {
          gpuUtilPct: metricsPayload?.gpuUtilPct ?? null,
          unifiedMemoryUsedGiB: metricsPayload?.unifiedMemoryUsedGiB ?? null,
          unifiedMemoryTotalGiB: metricsPayload?.unifiedMemoryTotalGiB ?? null,
          freeMemoryGiB: metricsPayload?.freeMemoryGiB ?? null,
          policyLabel: policyLabelJa(policyMode),
        },
        policy: {
          mode: policyMode,
          comfyStartBlockedHint: policyMode === 'business_first',
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
        },
        services,
        notes,
      };
    },
  };
}
