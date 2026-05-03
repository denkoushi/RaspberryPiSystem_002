import type { DgxPolicyMode } from './dgx-resource.policy-store.js';
import type { DgxControlTargetSnapshot, DgxServiceStatusKind } from './dgx-resource.control-target.types.js';
import type { DgxResourceMonitoringSummary } from './dgx-resource.monitoring-overview.js';
import { policyLabelJa } from './dgx-resource.policy-profile.js';
import type { DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';

/** 運用者向けワークロード（3系統）。Control Target の詳細は targetIds で辿る。 */
export type DgxOperatorWorkloadId = 'business_vlm' | 'private_comfy' | 'experiment_lab';

export type DgxOperatorRiskLevel = 'low' | 'medium' | 'high';

export type DgxOperatorWorkload = {
  id: DgxOperatorWorkloadId;
  labelJa: string;
  purposeJa: string;
  risk: DgxOperatorRiskLevel;
  /** 代表ステータス（最も業務への影響が大きいものを優先） */
  status: DgxServiceStatusKind;
  statusHeadlineJa: string;
  detailHintJa?: string;
  relatedTargetIds: Array<DgxControlTargetSnapshot['id']>;
  /** Pi5 に POST 起停 hook が揃っている主要ターゲットがあるか */
  runtimeControlConfigured: boolean;
};

export type DgxOperatorConsoleAction = {
  /** UI 安定キー（シナリオ ID と一致） */
  id: DgxOrchestrationScenarioId;
  labelJa: string;
  subtitleJa: string;
  scenarioId: DgxOrchestrationScenarioId;
  /** 主要導線として強調（現在のポリシーからの「次にありがちな操作」） */
  primary: boolean;
  disabledReasonJa?: string;
};

export type DgxResourceOperatorConsole = {
  workloads: DgxOperatorWorkload[];
  operatorSummary: {
    headlineJa: string;
    policyMode: DgxPolicyMode;
    policyLabelJa: string;
    previousMode: DgxPolicyMode | null;
    previousPolicyLabelJa: string | null;
    comfyStartBlockedHint: boolean;
    inferenceSparkLineJa: string | null;
    alertPreviewJa: string[];
  };
  operatorActions: DgxOperatorConsoleAction[];
};

const STATUS_RANK: Record<DgxServiceStatusKind, number> = {
  running: 0,
  unknown: 1,
  degraded: 2,
  stopped: 3,
};

function pickWorstStatus(a: DgxServiceStatusKind, b: DgxServiceStatusKind): DgxServiceStatusKind {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function statusJa(kind: DgxServiceStatusKind): string {
  switch (kind) {
    case 'running':
      return '稼働';
    case 'degraded':
      return '注意（degraded）';
    case 'stopped':
      return '停止または未到達';
    case 'unknown':
    default:
      return '不明';
  }
}

function inferBusinessRisk(
  g: DgxControlTargetSnapshot | undefined,
  inf: DgxControlTargetSnapshot | undefined,
  emb: DgxControlTargetSnapshot | undefined
): DgxOperatorRiskLevel {
  const worst = pickWorstStatus(
    pickWorstStatus(g?.status ?? 'unknown', inf?.status ?? 'unknown'),
    emb?.status ?? 'unknown'
  );
  if (worst === 'stopped' || worst === 'degraded') return 'high';
  if (worst === 'unknown') return 'medium';
  return 'low';
}

function buildBusinessWorkload(targets: DgxControlTargetSnapshot[]): DgxOperatorWorkload {
  const g = targets.find((t) => t.id === 'system-prod-gateway');
  const inf = targets.find((t) => t.id === 'system-prod-inference');
  const emb = targets.find((t) => t.id === 'system-prod-embedding');
  const st = pickWorstStatus(
    pickWorstStatus(g?.status ?? 'unknown', inf?.status ?? 'unknown'),
    emb?.status ?? 'unknown'
  );
  const risk = inferBusinessRisk(g, inf, emb);
  const gwJa = `Gateway: ${statusJa(g?.status ?? 'unknown')}`;
  const infJa = `推論: ${statusJa(inf?.status ?? 'unknown')}`;
  const embJa = `埋め込み: ${statusJa(emb?.status ?? 'unknown')}`;
  return {
    id: 'business_vlm',
    labelJa: '業務 VLM（Local LLM）',
    purposeJa: '日常業務のゲートウェイ・推論・埋め込みをまとめて見る用途です。',
    risk,
    status: st,
    statusHeadlineJa: `${gwJa} / ${infJa} / ${embJa}`,
    detailHintJa:
      inf?.status === 'degraded'
        ? '/v1/models が degraded のときは GPU 競合や cold start と混ざり得ます（監視アラートを確認）'
        : undefined,
    relatedTargetIds: ['system-prod-gateway', 'system-prod-inference', 'system-prod-embedding'],
    runtimeControlConfigured: Boolean(g?.capabilities.includes('start') && g?.capabilities.includes('stop')),
  };
}

function buildPrivateComfyWorkload(targets: DgxControlTargetSnapshot[]): DgxOperatorWorkload {
  const t = targets.find((x) => x.id === 'private-comfyui');
  const st = t?.status ?? 'unknown';
  const risk: DgxOperatorRiskLevel = st === 'running' ? 'medium' : st === 'degraded' ? 'high' : 'low';
  return {
    id: 'private_comfy',
    labelJa: '私用 ComfyUI',
    purposeJa: '私用の画像生成ワークロードです（業務推論と GPU を共有します）。',
    risk,
    status: st,
    statusHeadlineJa: `ComfyUI: ${statusJa(st)}`,
    relatedTargetIds: ['private-comfyui'],
    runtimeControlConfigured: Boolean(t?.capabilities.includes('start') && t?.capabilities.includes('stop')),
  };
}

function buildExperimentLabWorkload(targets: DgxControlTargetSnapshot[]): DgxOperatorWorkload {
  const t = targets.find((x) => x.id === 'experiment-lab');
  const st = t?.status ?? 'unknown';
  const risk: DgxOperatorRiskLevel = st === 'running' ? 'high' : 'medium';
  return {
    id: 'experiment_lab',
    labelJa: '実験ラボ（experiment-lab）',
    purposeJa: '検証・実験用ワークロードです。業務推論との競合に注意してください。',
    risk,
    status: st,
    statusHeadlineJa: `experiment-lab: ${statusJa(st)}`,
    relatedTargetIds: ['experiment-lab'],
    runtimeControlConfigured: Boolean(t?.capabilities.includes('start') && t?.capabilities.includes('stop')),
  };
}

function buildAlertPreview(monitoring: DgxResourceMonitoringSummary, limit: number): string[] {
  return monitoring.alerts.slice(0, limit).map((a) => `${a.title}${a.level === 'danger' ? '（要対応）' : ''}`);
}

/**
 * Control Target スナップショットとモニタリング要約から、運用者向けコンソール表示モデルを生成する。
 * 既存の targets[] とは別レイヤー（翻訳・優先度付け）に留める。
 */
export function buildDgxResourceOperatorConsole(input: {
  policyMode: DgxPolicyMode;
  previousMode: DgxPolicyMode | null;
  comfyStartBlockedHint: boolean;
  targets: DgxControlTargetSnapshot[];
  monitoring: DgxResourceMonitoringSummary;
}): DgxResourceOperatorConsole {
  const { policyMode, previousMode, comfyStartBlockedHint, targets, monitoring } = input;
  const workloads = [
    buildBusinessWorkload(targets),
    buildPrivateComfyWorkload(targets),
    buildExperimentLabWorkload(targets),
  ];

  const currentPolicyLabelJa = policyLabelJa(policyMode);
  const prevLabel = previousMode != null ? policyLabelJa(previousMode) : null;

  const headlineJa = `現在の運用モードは「${currentPolicyLabelJa}」です。`;
  const inferenceSparkLine =
    monitoring.activeInferenceSummary != null
      ? monitoring.activeInferenceSummary
      : monitoring.sparkSummaryJa
        ? `Spark: ${monitoring.sparkSummaryJa}`
        : null;

  const operatorActions: DgxOperatorConsoleAction[] = [];

  const add = (a: DgxOperatorConsoleAction) => {
    operatorActions.push(a);
  };

  const primaryForPrivate = policyMode === 'business_first';
  const primaryForExperiment = policyMode === 'business_first';
  const primaryReturnFromPrivate = policyMode === 'private_ok';
  const primaryReturnFromExperiment = policyMode === 'experiment_first';

  add({
    id: 'business_to_private',
    scenarioId: 'business_to_private',
    labelJa: '私用を始める',
    subtitleJa:
      '「私用OK」へ切り替えます。Pi5 に Comfy の起停 URL が揃っていれば、続けて私用 ComfyUI の起動も依頼します。',
    primary: primaryForPrivate,
    disabledReasonJa: policyMode === 'private_ok' ? 'すでに「私用OK」です' : undefined,
  });

  add({
    id: 'private_to_business',
    scenarioId: 'private_to_business',
    labelJa: '業務に戻す（私用を終える）',
    subtitleJa: '必要な停止試行の後、「業務優先」へ戻します。',
    primary: primaryReturnFromPrivate,
  });

  add({
    id: 'business_to_experiment',
    scenarioId: 'business_to_experiment',
    labelJa: '実験を始める',
    subtitleJa: 'ワークロード調停（設定されている POST）の後、「実験優先」へ進みます。',
    primary: primaryForExperiment,
    disabledReasonJa: policyMode === 'experiment_first' ? 'すでに「実験優先」です' : undefined,
  });

  add({
    id: 'experiment_to_business',
    scenarioId: 'experiment_to_business',
    labelJa: '実験を終えて業務に戻す',
    subtitleJa: '調停による停止試行の後、「業務優先」へ戻します。失敗時はイベントログと個別復旧を確認してください。',
    primary: primaryReturnFromExperiment,
  });

  return {
    workloads,
    operatorSummary: {
      headlineJa,
      policyMode,
      policyLabelJa: currentPolicyLabelJa,
      previousMode,
      previousPolicyLabelJa: prevLabel,
      comfyStartBlockedHint,
      inferenceSparkLineJa: inferenceSparkLine,
      alertPreviewJa: buildAlertPreview(monitoring, 4),
    },
    operatorActions,
  };
}
