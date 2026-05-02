import {
  comfyPolicyBadgeApplicable,
  isBusinessFirstSuppressionHintActive,
} from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode } from './dgx-resource.policy-store.js';

import type {
  DgxControlTargetSnapshot,
  DgxServiceStatusKind,
} from './dgx-resource.control-target.types.js';
import type { MetricsPayload } from './dgx-resource.probes.js';
import type { LocalLlmRuntimeConfig, LocalLlmStatus } from '../local-llm-proxy.service.js';

export type OverviewProbeBundle = {
  policyMode: DgxPolicyMode;
  adminCfg: LocalLlmRuntimeConfig;
  gatewayStatus: LocalLlmStatus;
  modelsProbe: { ok: boolean; statusCode?: number };
  metricsConfigured: boolean;
  metricsPayload: MetricsPayload | undefined;
  comfyConfigured: boolean;
  comfyReachable: boolean;
  comfyProbeUrl?: string;
  embeddingConfigured: boolean;
  embeddingReachable: boolean;
  embeddingProbeDisplay?: string;
  sparkUrl?: string;
  sparkConfigured: boolean;
  sparkProbe: { ok: boolean; statusCode?: number; errorBrief?: string };
  runtimeControlConfigured: boolean;
};

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

/**
 * 後方互換用サービスカード（既存 UI / 外部契約）。targets と同じ判定根拠。
 */
export type DgxResourceServiceCard = {
  id: string;
  name: string;
  status: DgxServiceStatusKind;
  badges: string[];
  metaLines: string[];
};

export function buildLegacyServiceCards(bundle: OverviewProbeBundle): DgxResourceServiceCard[] {
  const {
    policyMode,
    adminCfg,
    gatewayStatus,
    modelsProbe,
    comfyConfigured,
    comfyReachable,
    comfyProbeUrl,
    embeddingConfigured,
    embeddingReachable,
    embeddingProbeDisplay,
  } = bundle;

  const gatewayCardStatus: DgxServiceStatusKind = gatewayStatus.configured
    ? gatewayStatus.health.ok
      ? 'running'
      : 'stopped'
    : 'unknown';

  const inferenceStatus: DgxServiceStatusKind = modelsProbe.ok
    ? 'running'
    : gatewayStatus.health.ok && gatewayStatus.configured
      ? 'degraded'
      : gatewayStatus.configured
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

  return [
    {
      id: 'system-prod-gateway',
      name: 'system-prod-gateway',
      status: gatewayCardStatus,
      badges: [],
      metaLines: [
        ...(adminCfg.baseUrl ? [`gateway: ${adminCfg.baseUrl}`] : []),
        ...(gatewayStatus.health.statusCode !== undefined
          ? [`health HTTP ${gatewayStatus.health.statusCode}`]
          : []),
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
      metaLines: comfyMetaLines(policyMode, comfyConfigured, comfyProbeUrl),
    },
    {
      id: 'system-prod-embedding',
      name: 'system-prod-embedding',
      status: embeddingStatus,
      badges: [],
      metaLines: embeddingConfigured && embeddingProbeDisplay ? [`probe: ${embeddingProbeDisplay}`] : [],
    },
  ];
}

export function buildControlTargetSnapshots(bundle: OverviewProbeBundle): DgxControlTargetSnapshot[] {
  const {
    policyMode,
    adminCfg,
    gatewayStatus,
    modelsProbe,
    metricsConfigured,
    metricsPayload,
    comfyConfigured,
    comfyReachable,
    comfyProbeUrl,
    embeddingConfigured,
    embeddingReachable,
    embeddingProbeDisplay,
    sparkUrl,
    sparkConfigured,
    sparkProbe,
    runtimeControlConfigured,
  } = bundle;

  const gatewayStatusKind: DgxServiceStatusKind = gatewayStatus.configured
    ? gatewayStatus.health.ok
      ? 'running'
      : 'stopped'
    : 'unknown';

  const inferenceStatus: DgxServiceStatusKind = modelsProbe.ok
    ? 'running'
    : gatewayStatus.health.ok && gatewayStatus.configured
      ? 'degraded'
      : gatewayStatus.configured
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

  const sparkStatus: DgxServiceStatusKind = !sparkConfigured
    ? 'unknown'
    : sparkProbe.ok
      ? 'running'
      : 'stopped';

  let metricsStatus: DgxServiceStatusKind = 'unknown';
  if (metricsConfigured) {
    metricsStatus = metricsPayload !== undefined ? 'running' : 'stopped';
  }

  const gatewayCaps: DgxControlTargetSnapshot['capabilities'] = runtimeControlConfigured
    ? ['readStatus', 'start', 'stop']
    : ['readStatus'];

  return [
    {
      id: 'system-prod-gateway',
      kind: 'gateway',
      displayName: 'system-prod-gateway',
      capabilities: gatewayCaps,
      status: gatewayStatusKind,
      badges: [],
      metaLines: [
        ...(adminCfg.baseUrl ? [`gateway: ${adminCfg.baseUrl}`] : []),
        ...(gatewayStatus.health.statusCode !== undefined
          ? [`health HTTP ${gatewayStatus.health.statusCode}`]
          : []),
      ],
    },
    {
      id: 'system-prod-inference',
      kind: 'http_probe',
      displayName: 'inference-backend (/v1/models)',
      capabilities: ['readStatus'],
      status: inferenceStatus,
      badges: modelsProbe.ok ? [] : inferenceStatus === 'degraded' ? ['degraded'] : [],
      metaLines: [
        ...(modelsProbe.statusCode !== undefined ? [`/v1/models → ${modelsProbe.statusCode}`] : []),
        ...(adminCfg.model ? [`model hint: ${adminCfg.model}`] : []),
      ],
    },
    {
      id: 'system-prod-embedding',
      kind: 'http_probe',
      displayName: 'system-prod-embedding',
      capabilities: ['readStatus'],
      status: embeddingStatus,
      badges: [],
      metaLines: embeddingConfigured && embeddingProbeDisplay ? [`probe: ${embeddingProbeDisplay}`] : [],
    },
    {
      id: 'private-comfyui',
      kind: 'http_probe',
      displayName: 'private-comfyui',
      capabilities: ['readStatus'],
      status: comfyUiStatus,
      badges: comfyBadges,
      metaLines: comfyMetaLines(policyMode, comfyConfigured, comfyProbeUrl),
    },
    {
      id: 'spark-host',
      kind: 'http_probe',
      displayName: 'DGX Spark ホスト（簡易疎通）',
      capabilities: ['readStatus'],
      status: sparkStatus,
      badges: [],
      metaLines: sparkConfigured && sparkUrl ? [`probe: GET ${sparkUrl}`] : [],
    },
    {
      id: 'metrics-kpi',
      kind: 'metrics_source',
      displayName: 'GPU/メモリ KPI（sidecar JSON）',
      capabilities: ['readStatus'],
      status: metricsStatus,
      badges: [],
      metaLines: metricsConfigured
        ? [`DGX_RESOURCE_METRICS_URL`, ...(metricsPayload ? ['snapshot: ok'] : ['snapshot: 未取得'])]
        : ['未設定（Runbook 参照）'],
    },
  ];
}
