import type { DgxResourceMonitoringAlertApi, DgxResourceMonitoringSummaryApi } from '../../../api/dgx-resource.types';

function toneClasses(level: DgxResourceMonitoringAlertApi['level']): string {
  switch (level) {
    case 'danger':
      return 'border-red-500/40 bg-red-950/45';
    case 'warning':
      return 'border-amber-500/35 bg-amber-950/40';
    default:
      return 'border-white/15 bg-slate-900/35';
  }
}

type Props = {
  monitoring: Pick<DgxResourceMonitoringSummaryApi, 'activeInferenceSummary' | 'sparkSummaryJa' | 'alerts' | 'targetHighlights'>;
};

/** Phase4 overview.monitoring をそのまま可視化 */
export function DgxResourceMonitoringPanel({ monitoring }: Props) {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-violet-400/25 bg-violet-950/35 p-3">
      <h2 className="text-lg font-semibold text-violet-50/95">運用監視ヒント</h2>

      <div className="space-y-1.5 text-sm leading-snug text-white/72">
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
        <div className="flex flex-wrap gap-1.5 text-xs font-mono text-white/65">
          {monitoring.targetHighlights.map((h) => (
            <span key={h.id} className="rounded border border-white/10 bg-black/35 px-1.5 py-0.5" title={`${h.id}: ${h.status}`}>
              {h.label}: {h.status}
            </span>
          ))}
        </div>
      ) : null}

      {monitoring.alerts.length === 0 ? (
        <p className="text-sm text-emerald-200/85">運用上の自動アラートはありません。</p>
      ) : (
        <ul className="max-h-[18rem] space-y-1.5 overflow-y-auto pr-0.5 text-sm leading-snug">
          {monitoring.alerts.map((a) => (
            <li
              key={`${a.code}-${a.title}`}
              className={`rounded px-2.5 py-1.5 text-white/88 ${toneClasses(a.level)}`}
            >
              <div className="font-semibold text-white/94">{a.title}</div>
              <div className="mt-0.5 text-[13px] text-white/70">{a.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
