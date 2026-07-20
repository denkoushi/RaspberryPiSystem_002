import type { AssemblyItemDetail } from './assemblyHomeItemPresentation';
import type { ReactNode } from 'react';

type Tone = 'cyan' | 'emerald' | 'amber';

type Props = {
  itemId: string;
  productNo: string;
  serialNo: string;
  machineName: string;
  progressText: string;
  progressPercent: number;
  details: AssemblyItemDetail[];
  expanded: boolean;
  onToggle: () => void;
  tone: Tone;
  action?: ReactNode;
};

const toneClassNames: Record<Tone, { accent: string; button: string; bar: string }> = {
  cyan: {
    accent: 'text-cyan-100',
    button: 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25',
    bar: 'bg-cyan-300'
  },
  emerald: {
    accent: 'text-emerald-100',
    button: 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25',
    bar: 'bg-emerald-300'
  },
  amber: {
    accent: 'text-amber-100',
    button: 'border-amber-300/35 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25',
    bar: 'bg-amber-300'
  }
};

export function AssemblyItemCard({
  itemId,
  productNo,
  serialNo,
  machineName,
  progressText,
  progressPercent,
  details,
  expanded,
  onToggle,
  tone,
  action
}: Props) {
  const detailId = `assembly-item-detail-${itemId}`;
  const toneClassName = toneClassNames[tone];
  const actionLabel = expanded ? '閉じる' : '開く';

  return (
    <article role="listitem" className="overflow-hidden rounded border border-white/15 bg-slate-950/45">
      <div className="flex min-h-11 items-center gap-1.5 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs font-bold tabular-nums">
          <span className="min-w-0 truncate text-white" title={productNo}>
            製番 {productNo}
          </span>
          <span className="shrink-0 text-white/80" title={serialNo}>
            作業ID {serialNo}
          </span>
          <span className={`shrink-0 ${toneClassName.accent}`}>進捗 {progressText}</span>
        </div>
        <button
          type="button"
          className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border text-sm font-bold ${toneClassName.button}`}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${productNo}・${serialNo} の詳細を${actionLabel}`}
          onClick={onToggle}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>
      </div>

      <p className="border-t border-white/10 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-200 break-words" title={machineName}>
        機種 {machineName}
      </p>

      {expanded ? (
        <div id={detailId} className="border-t border-white/10 bg-slate-900/45 px-2 py-2" role="region" aria-label={`${productNo}・${serialNo} の詳細`}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5">
            {details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="font-semibold text-white/55">{detail.label}</dt>
                <dd className="min-w-0 break-words font-semibold text-white">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {action ? <div className="mt-2 border-t border-white/10 pt-2">{action}</div> : null}
        </div>
      ) : null}

      <span aria-hidden="true" className={`block h-0.5 ${toneClassName.bar}`} style={{ width: `${progressPercent}%` }} />
    </article>
  );
}
