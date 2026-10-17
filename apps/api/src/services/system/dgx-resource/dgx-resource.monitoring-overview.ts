import type { LocalLlmRuntimeConfig } from '../local-llm-proxy.service.js';

import type { OverviewProbeBundle } from './dgx-resource.control-targets.builder.js';
import type { DgxControlTargetSnapshot, DgxServiceStatusKind } from './dgx-resource.control-target.types.js';
import type { DgxResourceScenarioFailureSummary } from './dgx-resource.policy-store.js';

export type DgxResourceMonitoringAlert = {
  level: 'info' | 'warning' | 'danger';
  code: string;
  title: string;
  detail: string;
};

export type DgxResourceMonitoringSummary = {
  /** admin 設定の model hint と /v1/models 応答ヒントを可能なら結合した一行 */
  activeInferenceSummary: string | null;
  sparkSummaryJa: string;
  alerts: DgxResourceMonitoringAlert[];
  targetHighlights: Array<{ id: string; label: string; status: DgxServiceStatusKind }>;
  lastScenarioFailure: DgxResourceScenarioFailureSummary | null;
};

const TARGET_LABELS: Partial<Record<string, string>> = {
  'system-prod-gateway': 'Gateway',
  'system-prod-inference': 'Inference (/v1/models)',
  'experiment-lab': 'experiment-lab',
  'agent-container': 'agent-container',
};

export function buildDgxResourceMonitoringOverview(input: {
  bundle: OverviewProbeBundle;
  targets: DgxControlTargetSnapshot[];
  adminCfg: LocalLlmRuntimeConfig;
  lastScenarioFailure: DgxResourceScenarioFailureSummary | null;
}): DgxResourceMonitoringSummary {
  const { bundle, targets } = input;
  const inferenceTarget = targets.find((t) => t.id === 'system-prod-inference');
  const expTarget = targets.find((t) => t.id === 'experiment-lab');
  const agentTarget = targets.find((t) => t.id === 'agent-container');

  const parts = [
    ...(input.adminCfg.model ? [`モデル構成ヒント: ${input.adminCfg.model}`] : []),
    ...(bundle.modelsProbe.inferenceHint ? [`/v1/models ヒント: ${bundle.modelsProbe.inferenceHint}`] : []),
  ];
  const activeInferenceSummary = parts.length > 0 ? parts.join(' · ') : null;

  let sparkSummaryJa = 'Sparkホスト監視オフ（URL 未設定）';
  if (bundle.sparkConfigured) {
    if (bundle.sparkProbe.ok && bundle.sparkProbe.statusCode !== undefined) {
      sparkSummaryJa = `Spark 応答あり（HTTP ${bundle.sparkProbe.statusCode}）`;
    } else if (bundle.sparkProbe.statusCode !== undefined) {
      sparkSummaryJa = `Spark 異常または未到達の可能性（HTTP ${bundle.sparkProbe.statusCode}${
        bundle.sparkProbe.errorBrief ? `・${bundle.sparkProbe.errorBrief}` : ''
      }）`;
    } else if (bundle.sparkProbe.errorBrief) {
      sparkSummaryJa = `Spark probe エラー（${bundle.sparkProbe.errorBrief}）`;
    } else {
      sparkSummaryJa = 'Spark 状態は不明または停止';
    }
  }

  const alerts: DgxResourceMonitoringAlert[] = [];

  if (inferenceTarget?.status === 'degraded' && bundle.modelsProbe.statusCode === 503) {
    alerts.push({
      level: 'info',
      code: 'possible_inference_loading',
      title: '/v1/models が 503',
      detail:
        '重いモデルのロードや blue cold start と一致する場合があります。しばらく待って再評価し、競合がある場合は GPU の状態を確認してください',
    });
  }

  if (
    expTarget?.status === 'running' &&
    (bundle.policyMode === 'business_first' || bundle.policyMode === 'private_ok')
  ) {
    alerts.push({
      level: 'info',
      code: 'experiment_lab_active_outside_profile',
      title: '実験ラボが稼働検知されていますがプロファイルが実験優先ではありません',
      detail: '意図した運用とズレないか確認してください',
    });
  }

  if (
    agentTarget?.status === 'running' &&
    (bundle.policyMode === 'business_first' || bundle.policyMode === 'private_ok')
  ) {
    alerts.push({
      level: 'info',
      code: 'agent_container_active_outside_profile',
      title: 'agent-container が稼働検知されていますがプロファイルが実験優先ではありません',
      detail: '業務優先では GPU を空けるため停止調停の対象になり得ます。意図した運用か確認してください',
    });
  }

  const lastScenarioFailure = input.lastScenarioFailure;
  if (lastScenarioFailure != null) {
    alerts.unshift({
      level: 'danger',
      code: 'last_scenario_failed',
      title: `直近のガイド実行が失敗: ${lastScenarioFailure.scenarioId}`,
      detail: `${lastScenarioFailure.message}（実行済ステップ order: ${lastScenarioFailure.completedStepOrders.join(', ') || 'none'}）`,
    });
  }

  const targetHighlights = [
    'system-prod-gateway',
    'system-prod-inference',
    'experiment-lab',
    'agent-container',
  ].map((id) => {
    const t = targets.find((x) => x.id === id);
    return {
      id,
      label: TARGET_LABELS[id] ?? id,
      status: t?.status ?? 'unknown',
    };
  });

  return {
    activeInferenceSummary,
    sparkSummaryJa,
    alerts,
    targetHighlights,
    lastScenarioFailure,
  };
}
