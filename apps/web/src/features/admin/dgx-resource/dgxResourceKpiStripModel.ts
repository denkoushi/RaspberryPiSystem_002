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
  hint?: string;
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
  const powerPct =
    kpis.gpuPowerDrawW != null && kpis.gpuPowerLimitW != null && kpis.gpuPowerLimitW > 0
      ? Math.min(100, (kpis.gpuPowerDrawW / kpis.gpuPowerLimitW) * 100)
      : null;

  const gpuHint = [kpis.gpuName, kpis.driverVersion ? `Driver ${kpis.driverVersion}` : null]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' / ');

  const items: DgxResourceKpiStripItemModel[] = [
    {
      key: 'gpu',
      label: 'GPU Util',
      value: kpis.gpuUtilPct == null ? '—' : `${Math.round(kpis.gpuUtilPct)}%`,
      ...(gpuHint ? { hint: gpuHint } : {}),
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

  if (kpis.gpuTemperatureC != null) {
    items.push({
      key: 'gpu-temp',
      label: 'GPU Temp',
      value: `${Math.round(kpis.gpuTemperatureC)}℃`,
      bar: {
        pct: Math.min(100, Math.max(0, (kpis.gpuTemperatureC / 90) * 100)),
        barClass: pctBarClass(kpis.gpuTemperatureC, (n) => n < 72, (n) => n < 82),
      },
    });
  }

  if (kpis.gpuPowerDrawW != null) {
    items.push({
      key: 'gpu-power',
      label: 'GPU Power',
      value:
        kpis.gpuPowerLimitW != null && kpis.gpuPowerLimitW > 0
          ? `${Math.round(kpis.gpuPowerDrawW)} / ${Math.round(kpis.gpuPowerLimitW)} W`
          : `${Math.round(kpis.gpuPowerDrawW)} W`,
      bar: {
        pct: powerPct,
        barClass: pctBarClass(powerPct, (n) => n < 80, (n) => n < 92),
      },
    });
  }

  return items;
}
