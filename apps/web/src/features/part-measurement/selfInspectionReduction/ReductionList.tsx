import { selfInspectionReductionLevelLabel, selfInspectionReductionLevelRank } from '@raspi-system/shared-types';
import clsx from 'clsx';


import { CpkGauge, LotBars, ToleranceStrip, VERDICT_COLORS, cpkColor } from './reductionCharts';
import { VerdictPill } from './reductionUi';
import {
  REDUCTION_PROCESS_LABELS,
  REDUCTION_VERDICT_LABELS,
  REDUCTION_VERDICT_ORDER,
  formatCpk,
  worstItem,
  type ReductionRow,
  type ReductionVerdictFilter
} from './selfInspectionReductionViewModel';

import type { SelfInspectionReductionVerdict } from '@raspi-system/shared-types';

const GRID =
  'grid grid-cols-[minmax(150px,1.1fr)_minmax(118px,0.75fr)_minmax(150px,1.3fr)_minmax(84px,0.5fr)_minmax(104px,0.6fr)_112px] items-center gap-x-3 px-4';

export function ReductionList({
  rows,
  counts,
  totalCount,
  verdictFilter,
  onVerdictFilterChange,
  selectedId,
  onSelect,
  minimumSampleCount,
  loading
}: {
  rows: readonly ReductionRow[];
  counts: Record<SelfInspectionReductionVerdict, number>;
  totalCount: number;
  verdictFilter: ReductionVerdictFilter;
  onVerdictFilterChange: (filter: ReductionVerdictFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  minimumSampleCount: number;
  loading: boolean;
}) {
  const filters: Array<{ value: ReductionVerdictFilter; label: string; count: number }> = [
    { value: null, label: 'すべて', count: totalCount },
    ...REDUCTION_VERDICT_ORDER.filter((verdict) => verdict !== 'unjudgeable' || counts.unjudgeable > 0).map(
      (verdict) => ({ value: verdict, label: REDUCTION_VERDICT_LABELS[verdict], count: counts[verdict] })
    )
  ];

  return (
    <section
      aria-label="品番ごとの判定"
      className="grid min-h-0 grid-rows-[auto_auto_1fr] overflow-hidden rounded-xl border border-[#243347] bg-[#141e2b]"
    >
      <div role="group" aria-label="判定で絞り込み" className="flex h-[52px] items-center gap-1.5 border-b border-[#243347] px-3">
        {filters.map((filter) => {
          const selected = filter.value === verdictFilter;
          return (
            <button
              key={filter.value ?? 'all'}
              type="button"
              aria-pressed={selected}
              onClick={() => onVerdictFilterChange(filter.value)}
              className={clsx(
                'inline-flex h-[38px] items-center gap-2 rounded-lg border px-3 text-[15px] font-bold',
                selected ? 'border-[#3a5476] bg-[#1f2f45] text-[#e8eef6]' : 'border-transparent text-[#aab8ca] hover:text-[#e8eef6]'
              )}
            >
              {filter.value ? (
                <i className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: VERDICT_COLORS[filter.value] }} />
              ) : null}
              {filter.label}
              <b className="font-mono font-semibold text-[#e8eef6]">{filter.count}</b>
            </button>
          );
        })}
      </div>
      <div className={clsx(GRID, 'h-10 border-b border-[#243347] text-[13px] font-medium text-[#72849b]')}>
        <span>品番 / 資源</span>
        <span>いまの検査</span>
        <span>公差の中での位置（直近）</span>
        <span>工程能力</span>
        <span>連続合格</span>
        <span className="justify-self-end">判定</span>
      </div>
      <div role="listbox" aria-label="品番" className="min-h-0 overflow-auto">
        {loading ? <p className="p-6 text-[#72849b]">読み込み中…</p> : null}
        {!loading && rows.length === 0 ? <p className="p-6 text-[#72849b]">該当する記録がありません</p> : null}
        {rows.map((row) => {
          const { part, judgement } = row;
          const item = worstItem(part);
          const rank = selfInspectionReductionLevelRank(part.metrics.level);
          const shortSample = part.metrics.sampleCount < minimumSampleCount;
          const selected = row.id === selectedId;
          const streakReset = judgement.effectiveConsecutivePassLots !== part.metrics.consecutivePassLots;
          return (
            <button
              key={row.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(row.id)}
              className={clsx(
                GRID,
                'relative h-16 w-full border-b border-[#1c2939] text-left hover:bg-[#172433]',
                selected && 'bg-[#1a2a3d] before:absolute before:inset-y-2.5 before:left-0 before:w-1 before:rounded-r before:bg-sky-300'
              )}
            >
              <span className="grid min-w-0 gap-0.5">
                <b className="font-mono text-[17px] font-semibold">{part.key.fhincd}</b>
                <span className="truncate text-[13px] text-[#72849b]">
                  {part.fhinmei}・{REDUCTION_PROCESS_LABELS[part.key.processGroup]}・{part.key.resourceCd}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[15px] font-bold text-[#aab8ca]">
                <span className="inline-flex gap-0.5" aria-hidden="true">
                  {[0, 1, 2, 3].map((step) => (
                    <i
                      key={step}
                      className={clsx(
                        'block h-4 w-1.5 rounded-sm',
                        step === rank ? 'bg-[#e2eaf4]' : step < rank ? 'bg-[#9fb2c9]' : 'bg-[#2a3a50]'
                      )}
                    />
                  ))}
                </span>
                {selfInspectionReductionLevelLabel(part.metrics.level)}
              </span>
              <span className="min-w-0">{item ? <ToleranceStrip item={item} fluid /> : <span className="text-sm text-[#72849b]">公差なし</span>}</span>
              <span className="grid gap-1.5">
                {shortSample ? (
                  <>
                    <b className="font-mono text-xl font-semibold leading-none text-[#72849b]">
                      {formatCpk(part.metrics.worstCpk)}
                      <span className="ml-1 font-sans text-[11px] font-medium">参考</span>
                    </b>
                    <span className="font-mono text-xs text-amber-300">
                      {part.metrics.sampleCount}/{minimumSampleCount}個
                    </span>
                  </>
                ) : (
                  <>
                    <b className="font-mono text-xl font-semibold leading-none" style={{ color: cpkColor(part.metrics.worstCpk) }}>
                      {formatCpk(part.metrics.worstCpk)}
                    </b>
                    <CpkGauge cpk={part.metrics.worstCpk} width={84} />
                  </>
                )}
              </span>
              <span className="grid gap-1.5">
                <b className="font-mono text-lg font-semibold leading-none">
                  {judgement.effectiveConsecutivePassLots}
                  <small className="ml-1 font-sans text-xs font-medium text-[#72849b]">ロット</small>
                  {streakReset ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="ml-1 inline h-3.5 w-3.5 align-[-1px] text-amber-300" role="img" aria-label="変化点から数え直し">
                      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
                    </svg>
                  ) : null}
                </b>
                <LotBars lots={part.recentLots} />
              </span>
              <span className="justify-self-end">
                <VerdictPill
                  verdict={judgement.verdict}
                  suffix={judgement.verdict === 'reduce' ? '↓' : judgement.verdict === 'restore' && judgement.target ? '↑' : undefined}
                />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
