/**
 * DGX リソース管理 UI の見た目トークン（Tailwind クラス文字列の単一ソース）。
 * コンポーネントはここを経由して配色・バッジ形を取得し、局所にクラスを散らさない。
 */

import type {
  DgxOperatorRiskLevelApi,
  DgxPolicyModeApi,
  DgxResourceMonitoringAlertApi,
  DgxResourceMonitoringSummaryApi,
  DgxServiceStatusKind,
} from '../../../api/dgx-resource.types';

/** ワークロードカード外周（リスク帯） */
export function workloadRiskCardTokens(risk: DgxOperatorRiskLevelApi): string {
  switch (risk) {
    case 'high':
      return 'border-red-400/50 bg-red-950/40';
    case 'medium':
      return 'border-amber-400/45 bg-amber-950/35';
    default:
      return 'border-emerald-400/40 bg-emerald-950/30';
  }
}

/** サービス状態バッジ（文字込みで十分なコントラスト） */
export function statusBadgeTokens(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'degraded':
      return 'border border-amber-200 bg-amber-50 text-amber-700';
    case 'stopped':
      return 'border border-slate-200 bg-slate-50 text-slate-600';
    default:
      return 'border border-slate-300 bg-white text-slate-500';
  }
}

/** ステータス点在インジケータ（運用バー用） */
export function serviceStatusDotTokens(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]';
    case 'degraded':
      return 'bg-amber-400';
    case 'stopped':
      return 'bg-red-400';
    default:
      return 'bg-slate-500';
  }
}

/** 運用ポリシー・モードバッジ（StatusBar） */
export function policyModeBadgeTokens(mode: DgxPolicyModeApi): string {
  switch (mode) {
    case 'business_first':
      return 'border border-amber-200 bg-amber-50 text-amber-700';
    case 'private_ok':
      return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'experiment_first':
      return 'border border-violet-200 bg-violet-50 text-violet-700';
    default: {
      const _x: never = mode;
      return _x;
    }
  }
}

/** monitoring アラート行のコンテナ */
export function monitoringAlertContainerTokens(level: DgxResourceMonitoringAlertApi['level']): string {
  switch (level) {
    case 'danger':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

const INFERENCE_ANOMALY_RE = /warn|degraded|502|503|失敗|不可|timeout|error|offline|停止|connection\s+refused/i;

/** Inference 要約が異常系っぽいか（短文ヒント用のヒューリスティクス） */
export function inferenceSummaryLooksAnomalous(summary: string | null | undefined): boolean {
  if (summary == null || summary.trim() === '') return false;
  return INFERENCE_ANOMALY_RE.test(summary);
}

type MonitoringVisibilityInput = Pick<
  DgxResourceMonitoringSummaryApi,
  'alerts' | 'lastScenarioFailure' | 'activeInferenceSummary'
>;

/**
 * 右カラムの「運用監視ヒント」パネル全体を出すか。
 * 正常時は StatusBar に集約し、例外・警告・直近ガイド失敗・異常っぽい Inference のみパネル表示。
 */
export function shouldShowMonitoringPanel(m: MonitoringVisibilityInput): boolean {
  if (m.alerts.length > 0) return true;
  if (m.lastScenarioFailure != null) return true;
  if (inferenceSummaryLooksAnomalous(m.activeInferenceSummary)) return true;
  return false;
}
