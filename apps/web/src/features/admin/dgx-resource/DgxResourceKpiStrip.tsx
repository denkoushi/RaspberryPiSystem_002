import { buildDgxResourceKpiStripItems } from './dgxResourceKpiStripModel';

import type { DgxResourceKpis } from '../../../api/dgx-resource.types';

type Props = {
  kpis: DgxResourceKpis;
};

/** overview.kpis を KPI ストリップとして描画（モデルは dgxResourceKpiStripModel）。 */
export function DgxResourceKpiStrip({ kpis }: Props) {
  const items = buildDgxResourceKpiStripItems(kpis);

  return (
    <section
      className="flex flex-nowrap gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
      aria-label="DGX リソース KPI"
    >
      {items.map((it) => (
        <div
          key={it.key}
          className="min-w-[13.5rem] shrink-0 rounded-xl border border-white/10 bg-slate-900/50 px-4 py-4 lg:min-w-0 lg:flex-1 lg:basis-0"
        >
          <div className="break-words text-sm font-medium uppercase tracking-wide text-white/60">{it.label}</div>
          <div className="break-words text-3xl font-bold leading-snug text-white xl:text-4xl">{it.value}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950/80">
            {it.bar.pct == null ? (
              <div className="h-full w-1/6 bg-slate-600" />
            ) : (
              <div className={`h-full ${it.bar.barClass}`} style={{ width: `${it.bar.pct}%` }} />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
