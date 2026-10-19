import { formatHours, formatMonthLabel, resolveLoadLevel, type LoadLevel } from './loadBalancingFormat';
import { LATE_BUCKET, readCapacity, readLoad, type LoadMatrix } from './loadBalancingScenario';

import type { ProductionScheduleLoadBalancingWorkspaceResource } from '../../../api/client';

export type HeatmapResourceRow = {
  resource: ProductionScheduleLoadBalancingWorkspaceResource;
  displayName: string;
};

export type HeatmapSelection = { resourceCd: string; bucket: string };

type Props = {
  rows: HeatmapResourceRow[];
  buckets: string[];
  currentMonth: string;
  matrix: LoadMatrix;
  baseMatrix: LoadMatrix;
  /** 機種で絞り込み中のとき、その機種の分 */
  machineMatrix: LoadMatrix | null;
  selected: HeatmapSelection | null;
  highlightUnset: boolean;
  onSelect: (selection: HeatmapSelection) => void;
  onEditCapacity: (resourceCd: string) => void;
};

const levelClass: Record<LoadLevel, string> = {
  empty: 'bg-slate-800/60 text-white/35',
  normal: 'bg-[#16263d] text-sky-100/80',
  near: 'bg-amber-800 text-amber-100',
  over: 'bg-rose-800 text-rose-100',
  hot: 'bg-rose-600 text-white'
};

const UNSET_CELL =
  'bg-[repeating-linear-gradient(135deg,#1b2638_0_6px,#223049_6px_12px)] text-white/70';

export function LoadBalancingHeatmap({
  rows,
  buckets,
  currentMonth,
  matrix,
  baseMatrix,
  machineMatrix,
  selected,
  highlightUnset,
  onSelect,
  onEditCapacity
}: Props) {
  return (
    <table className="w-full border-separate border-spacing-[3px] text-[15px]" data-testid="load-balancing-heatmap">
      <thead>
        <tr>
          <th className="sticky top-0 z-[2] h-9 bg-slate-900 pl-2 text-left text-sm font-bold text-white/60">資源</th>
          {buckets.map((bucket) => (
            <th
              key={bucket}
              className={`sticky top-0 z-[2] h-9 w-[104px] bg-slate-900 text-sm font-bold ${
                bucket === currentMonth ? 'text-white' : 'text-white/60'
              }`}
            >
              {formatMonthLabel(bucket)}
              {bucket === currentMonth ? ' ●' : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ resource, displayName }) => {
          const unset = resource.baseCapacityMinutes == null;
          const dim = highlightUnset && !unset;
          return (
            <tr key={resource.resourceCd} className={dim ? 'opacity-30' : undefined}>
              <td className="whitespace-nowrap px-2">
                <span className="mr-2 font-mono font-extrabold">{resource.resourceCd}</span>
                <span className="text-sm text-white/65">{displayName}</span>
                <button
                  type="button"
                  className={`float-right mt-0.5 rounded px-1.5 text-xs tabular-nums ${
                    unset ? 'bg-amber-700/70 font-bold text-amber-50' : 'text-white/45 hover:bg-slate-700'
                  }`}
                  aria-label={`${resource.resourceCd} の能力を編集`}
                  onClick={() => onEditCapacity(resource.resourceCd)}
                >
                  {unset ? '能力？' : `${formatHours(resource.baseCapacityMinutes!)}H`}
                </button>
              </td>
              {buckets.map((bucket) => {
                const load = readLoad(matrix, resource.resourceCd, bucket);
                const delta = load - readLoad(baseMatrix, resource.resourceCd, bucket);
                const capacity = readCapacity(resource, bucket);
                const isSelected = selected?.resourceCd === resource.resourceCd && selected.bucket === bucket;
                const machineShare = machineMatrix ? readLoad(machineMatrix, resource.resourceCd, bucket) : null;
                return (
                  <td
                    key={bucket}
                    className={`relative h-[38px] w-[104px] cursor-pointer rounded-md text-center tabular-nums ${cellClass(
                      bucket,
                      load,
                      capacity
                    )} ${isSelected ? 'outline outline-[3px] outline-offset-1 outline-white' : ''} ${
                      machineShare != null && machineShare < 1 ? 'opacity-25' : ''
                    }`}
                    aria-selected={isSelected}
                    onClick={() => onSelect({ resourceCd: resource.resourceCd, bucket })}
                  >
                    <CellLabel bucket={bucket} load={load} capacity={capacity} />
                    {machineShare != null && machineShare >= 1 ? (
                      <span className="absolute bottom-0 left-1 text-[11px] font-bold text-sky-200">
                        {formatHours(machineShare)}
                      </span>
                    ) : null}
                    {Math.abs(delta) >= 30 ? (
                      <span
                        className={`absolute right-1 top-0 text-[11px] font-extrabold ${
                          delta < 0 ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {delta < 0 ? '−' : '+'}
                        {formatHours(Math.abs(delta))}
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function cellClass(bucket: string, load: number, capacity: number | null): string {
  if (bucket === LATE_BUCKET) return load < 30 ? levelClass.empty : 'bg-[#2a1320] text-rose-300';
  if (capacity == null) return load < 30 ? levelClass.empty : UNSET_CELL;
  return levelClass[resolveLoadLevel(load, capacity)];
}

function CellLabel({ bucket, load, capacity }: { bucket: string; load: number; capacity: number | null }) {
  if (load < 30) return null;
  if (bucket === LATE_BUCKET || capacity == null) {
    return (
      <>
        <span className="font-extrabold">{formatHours(load)}</span>
        <span className="ml-0.5 text-xs">H</span>
      </>
    );
  }
  const over = load - capacity;
  return (
    <>
      <span className="font-extrabold">{capacity > 0 ? `${Math.round((load / capacity) * 100)}%` : '∞'}</span>
      {over >= 30 ? <span className="ml-1 text-xs">+{formatHours(over)}</span> : null}
    </>
  );
}
