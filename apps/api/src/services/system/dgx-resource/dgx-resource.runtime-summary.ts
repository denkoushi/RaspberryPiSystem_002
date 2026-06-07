import { resolveBusinessRuntimeStartProfile } from '../../inference/config/business-profile-intent.js';
import type { BusinessProfileIntentEnv } from '../../inference/config/business-profile-intent.js';
import { policyLabelJa } from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode } from './dgx-resource.policy-store.js';
import type { OverviewProbeBundle } from './dgx-resource.control-targets.builder.js';

/** overview 用の実行時状態（メトリクス KPI とは分離） */
export type DgxResourceRuntimeSummary = {
  activeProfileId: string | null;
  activeProfileDisplayNameJa: string | null;
  activeBackend: 'green' | 'blue' | null;
  /** 現時点スナップショット: gateway health + /v1/models が業務推論として利用可能 */
  businessReady: boolean;
  businessReadyDetailJa: string;
  policyMode: DgxPolicyMode;
  policyLabel: string;
  /** active backend 表示の根拠 */
  runtimeSource: 'model_profile_state' | 'env_fallback' | 'unknown';
  /** gateway は生きているが /v1/models が未準備 */
  inferenceDegraded: boolean;
  /** Pi5 が業務 on-demand /start に載せる意図（DGX active とは別に保持） */
  businessRuntimeIntentProfileId: string | null;
  businessRuntimeIntentSource: string | null;
  businessRuntimeIntentAlignedWithActive: boolean | null;
  /** DGX gateway 共有 owner/state。Private Pi5 直通 route も同じ状態を更新する。 */
  resourceOwner: 'business' | 'private' | 'experiment' | 'unknown';
  resourceOwnerLabelJa: string;
  resourceStateStatus: 'preparing' | 'ready' | 'released' | 'unknown';
  resourceStateDetailJa: string;
};

function resolveActiveProfileDisplay(
  bundle: OverviewProbeBundle
): { id: string | null; displayNameJa: string | null; backend: 'green' | 'blue' | null; source: DgxResourceRuntimeSummary['runtimeSource'] } {
  const mp = bundle.modelProfiles;
  if (mp.status === 'ok' && mp.activeProfileId) {
    const profile = mp.available.find((p) => p.id === mp.activeProfileId);
    const backend = (mp.activeStateBackend ?? profile?.backend ?? null) as 'green' | 'blue' | null;
    return {
      id: mp.activeProfileId,
      displayNameJa: profile?.displayNameJa ?? mp.activeProfileId,
      backend,
      source: 'model_profile_state',
    };
  }
  return { id: null, displayNameJa: null, backend: null, source: 'unknown' };
}

function evaluateBusinessReadySnapshot(bundle: OverviewProbeBundle): { ready: boolean; detailJa: string } {
  const gw = bundle.gatewayStatus;
  if (!gw.configured) {
    return { ready: false, detailJa: 'Gateway 未構成（admin LocalLLM 設定が必要）' };
  }
  if (!gw.health.ok) {
    const sc = gw.health.statusCode;
    const tail = typeof sc === 'number' ? `（HTTP ${sc}）` : '';
    return { ready: false, detailJa: `ゲートウェイ health 未準備${tail}` };
  }
  const ac = bundle.adminCfg;
  if (!ac.configured || !ac.baseUrl || !ac.sharedToken) {
    return { ready: false, detailJa: 'Inference 確認のため admin baseUrl / sharedToken が必要' };
  }
  if (bundle.modelsProbe.ok) {
    const hint = bundle.modelsProbe.inferenceHint ? `（${bundle.modelsProbe.inferenceHint}）` : '';
    return { ready: true, detailJa: `業務推論 Ready: /v1/models OK${hint}` };
  }
  const sc = bundle.modelsProbe.statusCode;
  const tail = typeof sc === 'number' ? `HTTP ${sc}` : 'モデル一覧未取得';
  return { ready: false, detailJa: `業務推論未 Ready: ${tail}` };
}

function ownerLabelJa(owner: DgxResourceRuntimeSummary['resourceOwner']): string {
  if (owner === 'business') return '業務';
  if (owner === 'private') return 'Private';
  if (owner === 'experiment') return '実験';
  return '不明';
}

function resolveResourceStateSnapshot(
  bundle: OverviewProbeBundle
): Pick<
  DgxResourceRuntimeSummary,
  'resourceOwner' | 'resourceOwnerLabelJa' | 'resourceStateStatus' | 'resourceStateDetailJa'
> {
  const state = bundle.modelProfiles.resourceState;
  if (!state) {
    return {
      resourceOwner: 'unknown',
      resourceOwnerLabelJa: '不明',
      resourceStateStatus: 'unknown',
      resourceStateDetailJa: 'DGX resource-state 未作成または未配備',
    };
  }
  const target = state.displayNameJa ?? state.modelProfileId ?? state.backend ?? '対象未記録';
  const guarantee = state.guaranteeLevel ? ` / ${state.guaranteeLevel}` : '';
  return {
    resourceOwner: state.owner,
    resourceOwnerLabelJa: ownerLabelJa(state.owner),
    resourceStateStatus: state.status,
    resourceStateDetailJa: `${target}（${state.status}${guarantee}）`,
  };
}

/**
 * overview 用 runtime state をプローブ束から構築（Strict Ready の待機は行わない）。
 */
function resolveBusinessIntentSnapshot(
  bundle: OverviewProbeBundle,
  intentEnv: BusinessProfileIntentEnv
): Pick<
  DgxResourceRuntimeSummary,
  'businessRuntimeIntentProfileId' | 'businessRuntimeIntentSource' | 'businessRuntimeIntentAlignedWithActive'
> {
  const resolved = resolveBusinessRuntimeStartProfile(intentEnv);
  const intentId = resolved?.modelProfileId ?? null;
  const activeId = bundle.modelProfiles.activeProfileId;
  return {
    businessRuntimeIntentProfileId: intentId,
    businessRuntimeIntentSource: resolved?.source ?? null,
    businessRuntimeIntentAlignedWithActive:
      intentId && activeId ? intentId === activeId : intentId || activeId ? false : null,
  };
}

export function buildDgxResourceRuntimeSummary(
  bundle: OverviewProbeBundle,
  policyMode: DgxPolicyMode,
  intentEnv?: BusinessProfileIntentEnv
): DgxResourceRuntimeSummary {
  const active = resolveActiveProfileDisplay(bundle);
  const business = evaluateBusinessReadySnapshot(bundle);
  const gatewayRunning = bundle.gatewayStatus.configured && bundle.gatewayStatus.health.ok;
  const inferenceDegraded = Boolean(gatewayRunning && !bundle.modelsProbe.ok && bundle.gatewayStatus.configured);
  const resourceState = resolveResourceStateSnapshot(bundle);
  const intentSnapshot = intentEnv ? resolveBusinessIntentSnapshot(bundle, intentEnv) : {
    businessRuntimeIntentProfileId: null,
    businessRuntimeIntentSource: null,
    businessRuntimeIntentAlignedWithActive: null,
  };

  return {
    activeProfileId: active.id,
    activeProfileDisplayNameJa: active.displayNameJa,
    activeBackend: active.backend,
    businessReady: business.ready,
    businessReadyDetailJa: business.detailJa,
    policyMode,
    policyLabel: policyLabelJa(policyMode),
    runtimeSource: active.source,
    inferenceDegraded,
    ...resourceState,
    ...intentSnapshot,
  };
}
