import clsx from 'clsx';

import {
  policyModeBadgeTokens,
  serviceStatusDotTokens,
  statusBadgeTokens,
  workloadRiskCardTokens,
} from './dgxResourceUi';

import type { DgxResourceOperatorConsoleApi, DgxResourceOverview } from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  operator: DgxResourceOperatorConsoleApi;
};

/**
 * 「今どのモードか」「業務/私用/実験がざっくりどう見えているか」の要約（主操作とは分離）。
 */
export function DgxResourceCurrentStateSummary({ overview, operator }: Props) {
  const summary = operator.operatorSummary;
  const mon = overview.monitoring;
  const alertCount = mon.alerts.length;
  const business = operator.workloads.find((w) => w.id === 'business_vlm');
  const infDotStatus = business?.status ?? 'unknown';
  const statusTooltip = [summary.headlineJa, summary.inferenceSparkLineJa, ...summary.alertPreviewJa]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-2.5 py-2"
        role="status"
        aria-label="運用状態サマリ"
      >
        <span
          className={clsx('rounded-full px-3 py-1.5 text-sm font-bold tracking-tight', policyModeBadgeTokens(summary.policyMode))}
        >
          {summary.policyLabelJa}
        </span>
        <span
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm font-medium text-white/90"
          title={statusTooltip || '業務推論の状態'}
        >
          <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', serviceStatusDotTokens(infDotStatus))} aria-hidden />
          業務推論
        </span>
        {alertCount > 0 ? (
          <span
            className="rounded-lg border border-amber-400/50 bg-amber-950/45 px-2.5 py-1.5 text-sm font-semibold text-amber-50"
            title={mon.alerts.map((a) => `${a.title}: ${a.detail}`).join('\n')}
          >
            注意 {alertCount}
          </span>
        ) : (
          <span className="rounded-lg border border-emerald-500/35 bg-emerald-950/30 px-2.5 py-1.5 text-sm font-medium text-emerald-100/95">
            注意なし
          </span>
        )}
        {summary.comfyStartBlockedHint ? (
          <span
            className="rounded-lg border border-amber-400/40 bg-amber-950/35 px-2 py-1 text-base leading-none"
            title="業務優先のため、私用 ComfyUI の起動抑止ヒントが有効です（仕様どおり）"
            aria-label="私用 Comfy 起動抑止ヒント"
          >
            🔒
          </span>
        ) : null}
        {summary.previousPolicyLabelJa ? (
          <span className="text-sm text-white/60" title={`直前のプロファイル: ${summary.previousPolicyLabelJa}`}>
            ↩ {summary.previousPolicyLabelJa}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-white/45 sm:text-sm">
          {new Date(overview.generatedAt).toLocaleTimeString('ja-JP')}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {operator.workloads.map((w) => (
          <div
            key={w.id}
            className={clsx(
              'flex max-w-[18rem] min-w-[11rem] flex-1 flex-col rounded-lg border px-2.5 py-2',
              workloadRiskCardTokens(w.risk)
            )}
            title={[w.purposeJa, w.detailHintJa].filter(Boolean).join(' — ')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold text-white">{w.labelJa}</span>
              <span className={clsx('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', statusBadgeTokens(w.status))}>
                {w.status}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-white/85">{w.statusHeadlineJa}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
