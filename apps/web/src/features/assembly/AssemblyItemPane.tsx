import { Button } from '../../components/ui/Button';

import type { ReactNode } from 'react';

type Tone = 'cyan' | 'emerald' | 'amber';

type Props = {
  heading: string;
  count: number;
  tone: Tone;
  loading: boolean;
  onReload: () => void;
  emptyMessage: string;
  children: ReactNode;
};

const countClassName: Record<Tone, string> = {
  cyan: 'text-cyan-200',
  emerald: 'text-emerald-200',
  amber: 'text-amber-200'
};

export function AssemblyItemPane({ heading, count, tone, loading, onReload, emptyMessage, children }: Props) {
  const headingId = `assembly-${tone}-pane-heading`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-[10rem] min-w-0 flex-1 flex-col overflow-hidden rounded border border-white/15 bg-slate-950/45 xl:min-h-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 px-2 py-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h2 id={headingId} className="text-sm font-bold leading-tight text-white">
            {heading}
          </h2>
          <span className={`text-xs font-bold ${countClassName[tone]}`}>{count}件</span>
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-10 shrink-0 !px-2.5 !py-0 text-xs"
          disabled={loading}
          onClick={onReload}
        >
          {loading ? '更新中…' : '再読込'}
        </Button>
      </div>

      {count === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-2">
          <p className="w-full rounded border border-white/10 bg-slate-900/65 px-3 py-6 text-center text-xs font-semibold text-white/55">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div role="list" aria-label={heading} className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
          {children}
        </div>
      )}
    </section>
  );
}
