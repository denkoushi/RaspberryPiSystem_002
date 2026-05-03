import { monitoringAlertContainerTokens } from './dgxResourceUi';

import type { DgxResourceMonitoringSummaryApi } from '../../../api/dgx-resource.types';

type Props = {
  monitoring: Pick<DgxResourceMonitoringSummaryApi, 'activeInferenceSummary' | 'sparkSummaryJa' | 'alerts' | 'targetHighlights'>;
};

/** Phase4 overview.monitoring をそのまま可視化 */
export function DgxResourceMonitoringPanel({ monitoring }: Props) {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-violet-400/25 bg-violet-950/35 p-3">
      <h2 className="text-lg font-semibold text-violet-50/95">運用監視ヒント</h2>

      <div className="space-y-1.5 text-base leading-snug text-white/75">
        {monitoring.activeInferenceSummary ? (
          <p title={monitoring.activeInferenceSummary} className="truncate">
            <span className="font-semibold text-violet-100/90">Inference 状況: </span>
            <span>{monitoring.activeInferenceSummary}</span>
          </p>
        ) : (
          <p className="text-white/45">Inference 状態の詳細ヒントは現在ありません。</p>
        )}
        <p>
          <span className="font-semibold text-violet-100/90">Spark: </span>
          {monitoring.sparkSummaryJa}
        </p>
      </div>

      {monitoring.targetHighlights.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-sm font-mono text-white/70">
          {monitoring.targetHighlights.map((h) => (
            <span key={h.id} className="rounded border border-white/10 bg-black/35 px-1.5 py-0.5" title={`${h.id}: ${h.status}`}>
              {h.label}: {h.status}
            </span>
          ))}
        </div>
      ) : null}

      {monitoring.alerts.length === 0 ? (
        <p className="text-base text-emerald-200/90">運用上の自動アラートはありません。</p>
      ) : (
        <ul className="max-h-[18rem] space-y-1.5 overflow-y-auto pr-0.5 text-sm leading-snug">
          {monitoring.alerts.map((a) => (
            <li
              key={`${a.code}-${a.title}`}
              className={`rounded-lg border px-2.5 py-2 text-white/90 ${monitoringAlertContainerTokens(a.level)}`}
            >
              <div className="text-base font-semibold text-white">{a.title}</div>
              <div className="mt-1 text-sm text-white/75">{a.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
