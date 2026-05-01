import type { DgxResourceKpis } from '../../../api/dgx-resource.types';

function pctBarClass(v: number | null, ok: (n: number) => boolean, warn: (n: number) => boolean): string {
  if (v == null) return 'bg-slate-600';
  if (ok(v)) return 'bg-sky-500';
  if (warn(v)) return 'bg-amber-500';
  return 'bg-red-500';
}

function formatMem(used: number | null, total: number | null): string {
  if (used != null && total != null) return `${used} / ${total} GiB`;
  if (used != null) return `${used} GiB`;
  return '—';
}

type Props = {
  kpis: DgxResourceKpis;
};

export function DgxResourceKpiStrip({ kpis }: Props) {
  const u = kpis.unifiedMemoryUsedGiB;
  const t = kpis.unifiedMemoryTotalGiB;
  const unifiedPct = u != null && t != null && t > 0 ? Math.min(100, (u / t) * 100) : null;

  const freePct =
    kpis.freeMemoryGiB != null && t != null && t > 0
      ? Math.min(100, (kpis.freeMemoryGiB / t) * 100)
      : null;

  const items: Array<{
    key: string;
    label: string;
    value: string;
    barPct: number | null;
    barClass: string;
  }> = [
    {
      key: 'gpu',
      label: 'GPU Util',
      value: kpis.gpuUtilPct == null ? '—' : `${Math.round(kpis.gpuUtilPct)}%`,
      barPct: kpis.gpuUtilPct == null ? null : Math.min(100, Math.max(0, kpis.gpuUtilPct)),
      barClass: pctBarClass(kpis.gpuUtilPct, (n) => n < 85, (n) => n < 95),
    },
    {
      key: 'umem',
      label: 'Unified Mem',
      value: formatMem(u, t),
      barPct: unifiedPct,
      barClass: pctBarClass(unifiedPct, (n) => n < 72, (n) => n < 85),
    },
    {
      key: 'free',
      label: 'Free Mem',
      value: kpis.freeMemoryGiB == null ? '—' : `${kpis.freeMemoryGiB} GiB`,
      barPct: freePct,
      barClass:
        kpis.freeMemoryGiB == null
          ? 'bg-slate-600'
          : kpis.freeMemoryGiB >= 24
            ? 'bg-emerald-500'
            : kpis.freeMemoryGiB >= 12
              ? 'bg-amber-500'
              : 'bg-red-500',
    },
    {
      key: 'pol',
      label: 'Policy',
      value: kpis.policyLabel,
      barPct: kpis.policyLabel === '業務優先' ? 100 : 40,
      barClass: kpis.policyLabel === '業務優先' ? 'bg-amber-500/90' : 'bg-emerald-500/80',
    },
  ];

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.key} className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-white/55">{it.label}</div>
          <div className="truncate text-lg font-bold leading-tight text-white">{it.value}</div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-950/80">
            {it.barPct == null ? (
              <div className="h-full w-1/6 bg-slate-600" />
            ) : (
              <div className={`h-full ${it.barClass}`} style={{ width: `${it.barPct}%` }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
