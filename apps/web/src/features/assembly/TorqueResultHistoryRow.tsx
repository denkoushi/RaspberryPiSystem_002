export type TorqueResultHistoryTone = 'success' | 'failure' | 'neutral';

export type TorqueResultHistoryRowProps = {
  locationLabel: string;
  recordedAt: string;
  valueLabel: string;
  resultLabel: string;
  resultTone?: TorqueResultHistoryTone;
  details?: string | null;
  'data-testid'?: string;
};

function resultClassName(tone: TorqueResultHistoryTone): string {
  if (tone === 'success') return 'text-2xl font-bold tabular-nums text-emerald-300';
  if (tone === 'failure') return 'text-2xl font-bold tabular-nums text-rose-300';
  return 'text-sm font-semibold text-slate-300';
}

/**
 * 通常組立と訓練で共有する、トルク実績1件の表示。
 * 記録の取得や判定ロジックは持たず、整形済みの値だけを受け取る。
 */
export function TorqueResultHistoryRow({
  locationLabel,
  recordedAt,
  valueLabel,
  resultLabel,
  resultTone = 'failure',
  details,
  'data-testid': dataTestId
}: TorqueResultHistoryRowProps) {
  return (
    <div
      className="grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 border-b border-white/10 px-3 py-2 text-xs"
      data-testid={dataTestId}
    >
      <div className="min-w-0">
        <div className="truncate font-semibold" title={locationLabel}>{locationLabel}</div>
        <div className="text-white/50">{new Date(recordedAt).toLocaleString()}</div>
        {details ? <div className="truncate text-white/65" title={details}>{details}</div> : null}
      </div>
      <div className="whitespace-nowrap text-2xl font-bold tabular-nums">{valueLabel}</div>
      <div className={resultClassName(resultTone)}>{resultLabel}</div>
    </div>
  );
}
