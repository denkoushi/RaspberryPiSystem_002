import {
  SELF_INSPECTION_REDUCTION_MAX_GAP_RATIO,
  selfInspectionReductionLevelLabel,
  selfInspectionReductionLevelRank,
  type SelfInspectionReductionCheckState,
  type SelfInspectionReductionLevel,
  type SelfInspectionReductionPolicy
} from '@raspi-system/shared-types';
import clsx from 'clsx';


import { RunChart, cpkColor } from './reductionCharts';
import { NfcPrompt, VerdictPill, kioskButtonClass } from './reductionUi';
import {
  REDUCTION_PROCESS_LABELS,
  cpkMargin,
  formatCpk,
  type ReductionRow
} from './selfInspectionReductionViewModel';

export type ReductionApprovalState = {
  armed: boolean;
  pending: boolean;
  message: string | null;
  onStart: () => void;
  onCancel: () => void;
};

const LADDER_MODES = ['full', 'fixed_count', 'first_last', 'single'] as const;

function ladderLabel(mode: (typeof LADDER_MODES)[number], current: SelfInspectionReductionLevel, target: SelfInspectionReductionLevel | null) {
  if (mode !== 'fixed_count') return selfInspectionReductionLevelLabel({ mode, fixedCount: null });
  const source = current.mode === 'fixed_count' ? current : target?.mode === 'fixed_count' ? target : null;
  return source ? selfInspectionReductionLevelLabel(source) : '指定数';
}

function LevelLadder({ current, target }: { current: SelfInspectionReductionLevel; target: SelfInspectionReductionLevel | null }) {
  const from = selfInspectionReductionLevelRank(current);
  const to = target ? selfInspectionReductionLevelRank(target) : null;
  const pos = (rank: number) => 12.5 + rank * 25;
  const down = to != null && to > from;
  return (
    <div className="relative grid grid-cols-4 pt-1.5" aria-label="検査の段">
      <span className="absolute left-[12.5%] right-[12.5%] top-[28px] h-0.5 bg-[#26364b]" />
      {to != null ? (
        <>
          <span
            className={clsx('absolute top-[27px] h-1 rounded', down ? 'bg-emerald-400' : 'bg-rose-400')}
            style={{ left: `${pos(Math.min(from, to))}%`, width: `${Math.abs(pos(to) - pos(from))}%` }}
          />
          <span
            className={clsx(
              '-translate-x-1/2 absolute -top-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold',
              down ? 'bg-[#10392d] text-emerald-400' : 'bg-[#40202a] text-rose-400'
            )}
            style={{ left: `${(pos(from) + pos(to)) / 2}%` }}
          >
            {down ? '1段軽く' : '1段重く'}
          </span>
        </>
      ) : null}
      {LADDER_MODES.map((mode, rank) => {
        const isCurrent = rank === from;
        const isTarget = rank === to;
        return (
          <div key={mode} className="relative grid justify-items-center gap-2 pb-1">
            <span
              className={clsx(
                'relative z-[1] grid h-11 w-11 place-items-center rounded-full border-2 bg-[#0c141e]',
                isCurrent && 'border-[#dfe8f3] bg-[#dfe8f3]',
                isTarget && down && 'border-dashed border-emerald-400',
                isTarget && !down && 'border-dashed border-rose-400',
                !isCurrent && !isTarget && 'border-[#2b3c53]'
              )}
            >
              <span className={clsx('block rounded-sm', isCurrent ? 'bg-[#0e1621]' : 'bg-[#72849b]')} style={{ width: 22 - rank * 4, height: 22 - rank * 4 }} />
            </span>
            <span
              className={clsx(
                'text-[15px] font-bold',
                isCurrent ? 'text-[#e8eef6]' : isTarget ? (down ? 'text-emerald-400' : 'text-rose-400') : 'text-[#72849b]'
              )}
            >
              {ladderLabel(mode, current, isTarget ? (target ?? null) : null)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const CHECK_ICON: Record<SelfInspectionReductionCheckState, { path: string; className: string }> = {
  ok: { path: 'M5 12l5 5 9-10', className: 'bg-[#10392d] text-emerald-400' },
  hold: { path: 'M12 6v7M12 18h.01', className: 'bg-[#3a2f12] text-amber-300' },
  ng: { path: 'M6 6l12 12M18 6L6 18', className: 'bg-[#40202a] text-rose-400' }
};

function Check({ state, title, value, goal }: { state: SelfInspectionReductionCheckState; title: string; value: string; goal?: string }) {
  const icon = CHECK_ICON[state];
  return (
    <div className="grid grid-cols-[28px_1fr] items-center gap-x-2 gap-y-0.5 rounded-[10px] border border-[#1f2d3f] bg-[#101925] px-3 py-2.5">
      <span className={clsx('row-span-2 grid h-7 w-7 place-items-center rounded-full', icon.className)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <path d={icon.path} />
        </svg>
      </span>
      <span className="text-sm font-bold">{title}</span>
      <span className="font-mono text-[13px] text-[#aab8ca]">
        {value}
        {goal ? <span className="font-sans text-[#72849b]"> / {goal}</span> : null}
      </span>
    </div>
  );
}

export function ReductionDetail({
  row,
  policy,
  approval,
  onOpenChangePoint
}: {
  row: ReductionRow | null;
  policy: SelfInspectionReductionPolicy;
  approval: ReductionApprovalState;
  onOpenChangePoint: () => void;
}) {
  if (!row) {
    return (
      <section className="grid place-items-center rounded-xl border border-[#243347] bg-[#141e2b] text-[#72849b]">
        品番を選んでください
      </section>
    );
  }
  const { part, judgement } = row;
  const { metrics } = part;
  const checks = judgement.checks;
  const streakFromChangePoint = judgement.effectiveConsecutivePassLots !== metrics.consecutivePassLots;
  const canDecide = judgement.target != null && (judgement.verdict === 'reduce' || judgement.verdict === 'restore');
  const decision = part.latestDecision;

  return (
    <section aria-label="判定の中身" className="flex min-h-0 flex-col gap-3.5 overflow-hidden rounded-xl border border-[#243347] bg-[#141e2b] px-5 py-[18px]">
      <div className="flex items-start gap-3.5">
        <div className="grid min-w-0 gap-1">
          <b className="truncate font-mono text-[26px] font-semibold leading-tight">{part.key.fhincd}</b>
          <span className="truncate text-[15px] text-[#aab8ca]">
            {part.fhinmei}{'\u3000'}{REDUCTION_PROCESS_LABELS[part.key.processGroup]}{'\u3000'}資源 {part.key.resourceCd}
            {part.machineName ? `\u3000${part.machineName}` : ''}{'\u3000'}1ロット {metrics.lotSize}個
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" className={clsx(kioskButtonClass, 'h-10 px-3 text-[15px]')} onClick={onOpenChangePoint}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
            </svg>
            変化点
          </button>
          {canDecide ? (
            <button
              type="button"
              disabled={approval.armed || approval.pending}
              onClick={approval.onStart}
              className={clsx(
                'inline-flex h-10 items-center rounded-lg border px-3 text-[15px] font-bold disabled:opacity-60',
                judgement.verdict === 'reduce'
                  ? 'border-emerald-400 bg-emerald-400 text-[#04241a]'
                  : 'border-rose-400 bg-transparent text-[#ffb3c0]'
              )}
            >
              {judgement.verdict === 'reduce' ? '1段下げる' : '1段上げる'}
            </button>
          ) : (
            <VerdictPill verdict={judgement.verdict} size="lg" />
          )}
        </div>
      </div>

      {approval.armed ? (
        <NfcPrompt
          action={
            <button type="button" className={clsx(kioskButtonClass, 'h-10 px-3 text-[15px]')} onClick={approval.onCancel}>
              やめる
            </button>
          }
        >
          承認者の社員タグをタッチ
        </NfcPrompt>
      ) : null}
      {approval.message ? (
        <p role="status" className="rounded-lg border border-[#2f4159] bg-[#101925] px-4 py-2 text-[15px] font-bold">
          {approval.message}
        </p>
      ) : decision?.awaitingRevision ? (
        <p className="rounded-lg border border-emerald-400/40 bg-[#0f2a26] px-4 py-2 text-[15px] font-bold text-emerald-200">
          承認済み → {selfInspectionReductionLevelLabel(decision.toLevel)}（{decision.approverName}）・管理画面で改版待ち
        </p>
      ) : null}

      <LevelLadder current={metrics.level} target={judgement.target} />

      <div className="grid grid-cols-3 gap-2">
        <Check state={checks.sample} title="データ量" value={`${metrics.sampleCount}個`} goal={`${policy.minimumSampleCount}個以上`} />
        <Check state={checks.cpk} title="公差の余裕" value={`Cpk ${formatCpk(metrics.worstCpk)}`} goal={`${policy.cpkThreshold}以上`} />
        <Check
          state={checks.streak}
          title="連続合格"
          value={`${judgement.effectiveConsecutivePassLots}ロット`}
          goal={`${policy.requiredConsecutiveLots}以上${streakFromChangePoint ? '・変化点から' : ''}`}
        />
        <Check state={checks.drift} title="ずれの傾向" value={metrics.drift ? '上限・下限へ寄っている' : 'なし'} />
        <Check
          state={checks.gap}
          title="測り方の差"
          value={metrics.measurementGapRatio == null ? '再測定なし' : `${Math.round(metrics.measurementGapRatio * 100)}%`}
          goal={`公差の${Math.round(SELF_INSPECTION_REDUCTION_MAX_GAP_RATIO * 100)}%以内`}
        />
        <Check
          state={checks.quality}
          title="規格外・後工程"
          value={`規格外 ${metrics.outOfToleranceCount}・不適合 ${metrics.nonconformityCount}`}
          goal="0件"
        />
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-[minmax(170px,1fr)] grid-cols-2 gap-2.5 overflow-auto pt-2.5">
        {[...part.items].sort((a, b) => Number(b.key === part.worstItemKey) - Number(a.key === part.worstItemKey)).map((item) => {
          const margin = cpkMargin(item.cpk);
          const worst = item.key === part.worstItemKey;
          return (
            <div
              key={item.key}
              className={clsx(
                'relative grid min-h-0 grid-rows-[auto_1fr] rounded-[10px] border bg-[#101925] px-3 pb-1.5 pt-2.5',
                worst ? 'border-[#4a5a2a] ring-1 ring-inset ring-[#4a5a2a]' : 'border-[#1f2d3f]'
              )}
            >
              {worst && part.items.length > 1 ? (
                <span className="absolute -top-2.5 right-2.5 rounded-full bg-[#4a5a2a] px-2 py-0.5 text-[11px] font-bold text-[#e9f5c4]">
                  判定を決めている項目
                </span>
              ) : null}
              <div className="flex items-baseline gap-2">
                <b className="truncate text-[15px]">
                  {item.marker ? `${item.marker} ` : ''}
                  {item.label}
                </b>
                <span className="truncate font-mono text-xs text-[#72849b]">{item.point}</span>
                <span className="ml-auto whitespace-nowrap font-mono text-[15px] font-semibold" style={{ color: cpkColor(item.cpk) }}>
                  {formatCpk(item.cpk)} {margin.label}
                </span>
              </div>
              <div className="min-h-0">
                <RunChart item={item} changePoints={part.changePoints} />
              </div>
            </div>
          );
        })}
        {part.items.length === 0 ? <p className="col-span-2 self-center text-center text-[#72849b]">公差の入った数値項目がありません</p> : null}
      </div>
    </section>
  );
}
