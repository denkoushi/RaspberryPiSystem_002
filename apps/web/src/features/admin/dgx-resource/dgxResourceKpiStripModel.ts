import type { DgxResourceKpis } from '../../../api/dgx-resource.types';

/** KPI ストリップの 1 カード分（描画層は JSX でこのモデルを列挙するだけにする） */
export type DgxResourceKpiStripBarModel = {
  pct: number | null;
  barClass: string;
};

export type DgxResourceKpiStripItemModel = {
  key: string;
  label: string;
  value: string;
  bar: DgxResourceKpiStripBarModel;
};

function pctBarClass(v: number | null, ok: (n: number) => boolean, warn: (n: number) => boolean): string {
  if (v == null) return 'bg-slate-600';
  if (ok(v)) return 'bg-sky-500';
  if (warn(v)) return 'bg-amber-500';
  return 'bg-red-500';
}

export function formatUnifiedMemDisplay(used: number | null, total: number | null): string {
  if (used != null && total != null) return `${used} / ${total} GiB`;
  if (used != null) return `${used} GiB`;
  return '—';
}

/**
 * overview.kpis から純メトリクス KPI ストリップ用の表示モデルを構築する（React 非依存）。
 * 運用状態（Policy / Active Model 等）は runtimeSummary 側で表示する。
 */
export function buildDgxResourceKpiStripItems(kpis: DgxResourceKpis): readonly DgxResourceKpiStripItemModel[] {
  const u = kpis.unifiedMemoryUsedGiB;
  const t = kpis.unifiedMemoryTotalGiB;
  const unifiedPct = u != null && t != null && t > 0 ? Math.min(100, (u / t) * 100) : null;

  const freePct =
    kpis.freeMemoryGiB != null && t != null && t > 0 ? Math.min(100, (kpis.freeMemoryGiB / t) * 100) : null;

  return [
    {
      key: 'gpu',
      label: 'GPU Util',
      value: kpis.gpuUtilPct == null ? '—' : `${Math.round(kpis.gpuUtilPct)}%`,
      bar: {
        pct: kpis.gpuUtilPct == null ? null : Math.min(100, Math.max(0, kpis.gpuUtilPct)),
        barClass: pctBarClass(kpis.gpuUtilPct, (n) => n < 85, (n) => n < 95),
      },
    },
    {
      key: 'umem',
      label: 'Unified Mem',
      value: formatUnifiedMemDisplay(u, t),
      bar: {
        pct: unifiedPct,
        barClass: pctBarClass(unifiedPct, (n) => n < 72, (n) => n < 85),
      },
    },
    {
      key: 'free',
      label: 'Free Mem',
      value: kpis.freeMemoryGiB == null ? '—' : `${kpis.freeMemoryGiB} GiB`,
      bar: {
        pct: freePct,
        barClass:
          kpis.freeMemoryGiB == null
            ? 'bg-slate-600'
            : kpis.freeMemoryGiB >= 24
              ? 'bg-emerald-500'
              : kpis.freeMemoryGiB >= 12
                ? 'bg-amber-500'
                : 'bg-red-500',
      },
    },
  ];
}
