import clsx from 'clsx';

import { GANTT_SCALES, ganttScaleLabel } from './gantt/usePersistedPlanningBoardGanttScale';

import type { PlanningBoardGanttMode } from './gantt/usePersistedPlanningBoardGanttMode';
import type { PlanningBoardGanttScale } from './gantt/usePersistedPlanningBoardGanttScale';
import type { PlanningBoardAllocation, PlanningBoardStatus } from './types';
import type {
  GrindingPlanningBoardSpecialDueKind,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';
import type { ReactNode } from 'react';



type SegmentTone = 'filter' | 'gantt' | 'scale';

type SegmentButtonProps = {
  pressed: boolean;
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  disabled?: boolean;
  tone?: SegmentTone;
};

// Solid emerald is reserved for the bulk action; a selected filter is white and the Gantt cluster is sky.
const SEGMENT_TONE_CLASS: Record<SegmentTone, { on: string; off: string }> = {
  filter: { on: 'bg-slate-100 font-bold text-slate-950', off: 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' },
  gantt: { on: 'bg-sky-400 font-bold text-slate-950', off: 'font-bold text-sky-400 hover:bg-sky-400/15' },
  scale: { on: 'text-white ring-2 ring-inset ring-sky-400', off: 'text-sky-300 hover:bg-sky-400/15' }
};

function SegmentButton({ pressed, children, onClick, ariaLabel, disabled = false, tone = 'filter' }: SegmentButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'min-h-11 shrink-0 rounded-md px-2 text-[13px] font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300',
        pressed ? SEGMENT_TONE_CLASS[tone].on : SEGMENT_TONE_CLASS[tone].off
      )}
    >
      {children}
    </button>
  );
}

const SEGMENT_TRACK_CLASS = 'flex shrink-0 items-center gap-0.5 rounded-[9px] border p-0.5';

function SegmentGroup({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div className={clsx(SEGMENT_TRACK_CLASS, 'border-slate-700 bg-slate-900')} role="group" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export type PlanningBoardToolbarProps = {
  ganttEnabled?: boolean;
  onToggleGantt?: () => void;
  ganttScale?: PlanningBoardGanttScale;
  onGanttScaleChange?: (scale: PlanningBoardGanttScale) => void;
  ganttMode?: PlanningBoardGanttMode;
  onGanttModeChange?: (mode: PlanningBoardGanttMode) => void;
  lateCount?: number;
  onNextLate?: () => void;
  onSortDue?: () => void;
  onUndoOrder?: () => void;
  orderDisabled?: boolean;
  canUndoOrder?: boolean;
  overlapCount?: number;
  onNextOverlap?: () => void;
  categories: { grinding: boolean; cutting: boolean };
  view: GrindingPlanningBoardView;
  status: PlanningBoardStatus;
  allocation: PlanningBoardAllocation;
  selectedCount: number;
  bulkDisabled?: boolean;
  scopeDisabled?: boolean;
  registeredCount: number;
  feedback?: ReactNode;
  onOpenDrawer: () => void;
  onCategoriesChange: (categories: { grinding: boolean; cutting: boolean }) => void;
  onViewChange: (view: GrindingPlanningBoardView) => void;
  onStatusChange: (status: PlanningBoardStatus) => void;
  onAllocationChange: (allocation: PlanningBoardAllocation) => void;
  onOpenDueEditor: () => void;
  specialDueMode?: GrindingPlanningBoardSpecialDueKind | null;
  onSpecialDueModeChange?: (mode: GrindingPlanningBoardSpecialDueKind | null) => void;
  specialDueDisabled?: boolean;
  specialDueCounts?: Record<GrindingPlanningBoardSpecialDueKind, number>;
};

export function PlanningBoardToolbar({
  ganttEnabled = false,
  onToggleGantt,
  ganttScale = 14,
  onGanttScaleChange,
  ganttMode = 'forward', onGanttModeChange, lateCount = 0, onNextLate,
  onSortDue, onUndoOrder, orderDisabled = false, canUndoOrder = false,
  overlapCount = 0,
  onNextOverlap,
  categories,
  view,
  status,
  allocation,
  selectedCount,
  bulkDisabled = false,
  scopeDisabled = false,
  registeredCount,
  feedback,
  onOpenDrawer,
  onCategoriesChange,
  onViewChange,
  onStatusChange,
  onAllocationChange,
  onOpenDueEditor,
  specialDueMode = null,
  onSpecialDueModeChange,
  specialDueDisabled = false,
  specialDueCounts = { overnight: 0, today: 0 }
}: PlanningBoardToolbarProps) {
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-925 px-2 py-1.5">
      <button
        type="button"
        onClick={onOpenDrawer}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-slate-500 bg-slate-800 pl-3 pr-2 text-[13px] font-bold text-slate-100 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        aria-label="製番登録ペインを開く"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-[15px] w-[15px]" aria-hidden="true">
          <rect x="1" y="2.5" width="14" height="2" rx="1" /><rect x="1" y="7" width="14" height="2" rx="1" /><rect x="1" y="11.5" width="14" height="2" rx="1" />
        </svg>
        製番
        <span className="min-w-6 rounded-full bg-slate-950 px-1.5 py-0.5 text-center tabular-nums text-emerald-300">{registeredCount}</span>
      </button>
      <SegmentGroup ariaLabel="工程">
        <SegmentButton disabled={scopeDisabled} pressed={categories.grinding} onClick={() => { if (categories.cutting) onCategoriesChange({ ...categories, grinding: !categories.grinding }); }}>
          研削
        </SegmentButton>
        <SegmentButton disabled={scopeDisabled} pressed={categories.cutting} onClick={() => { if (categories.grinding) onCategoriesChange({ ...categories, cutting: !categories.cutting }); }}>
          切削
        </SegmentButton>
      </SegmentGroup>
      <SegmentGroup ariaLabel="表示単位">
        <SegmentButton pressed={view === 'seiban'} onClick={() => onViewChange('seiban')}>
          製番
        </SegmentButton>
        <SegmentButton pressed={view === 'resource'} onClick={() => onViewChange('resource')}>
          資源CD
        </SegmentButton>
      </SegmentGroup>
      {onToggleGantt && <div className={clsx(SEGMENT_TRACK_CLASS, 'border-sky-400/55 bg-sky-400/10')}>
        <SegmentButton tone="gantt" pressed={ganttEnabled} onClick={onToggleGantt}>
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <rect x="1" y="2" width="8" height="3" rx="1" /><rect x="5" y="6.5" width="9" height="3" rx="1" /><rect x="3" y="11" width="6" height="3" rx="1" />
            </svg>ガント
          </span>
        </SegmentButton>
        {ganttEnabled && <>
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="並べ方">
            <span className="px-1 text-[10px] text-slate-400">並べ方</span>
            <SegmentButton tone="gantt" pressed={ganttMode === 'forward'} onClick={() => onGanttModeChange?.('forward')}>今日から</SegmentButton>
            <SegmentButton tone="gantt" pressed={ganttMode === 'backward'} onClick={() => onGanttModeChange?.('backward')}>納期から</SegmentButton>
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-0.5" role="group" aria-label="横軸の幅">
            {GANTT_SCALES.map((days) => <SegmentButton key={days} tone="scale" pressed={ganttScale === days} onClick={() => onGanttScaleChange?.(days)}>{ganttScaleLabel(days)}</SegmentButton>)}
          </div>
          <button type="button" onClick={ganttMode === 'forward' ? onNextLate : onNextOverlap}
            className={clsx('ml-1 min-h-11 shrink-0 rounded-md px-2 text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300', (ganttMode === 'forward' ? lateCount : overlapCount) ? 'bg-rose-800 text-white' : 'text-emerald-300')}>
            {ganttMode === 'forward' ? (lateCount ? `⚠ 遅れ ${lateCount}` : '✓ 遅れなし') : (overlapCount ? `⚠ 重なり ${overlapCount}` : '✓ 重なりなし')}
          </button>
          <button type="button" aria-label="⇅ 納期順に並べる" onClick={onSortDue}
            disabled={ganttMode !== 'forward' || allocation !== 'alternate' || orderDisabled}
            className="min-h-11 shrink-0 rounded-md bg-emerald-900 px-2 text-[13px] font-bold text-emerald-100 disabled:opacity-40">⇅ 納期順</button>
          <button type="button" onClick={onUndoOrder}
            disabled={ganttMode !== 'forward' || allocation !== 'alternate' || orderDisabled || !canUndoOrder}
            className="min-h-11 shrink-0 rounded-md border border-slate-600 px-2 text-[13px] font-bold text-slate-200 disabled:opacity-40">↶ 戻す</button>
        </>}
      </div>}
      <SegmentGroup ariaLabel="進捗">
        <SegmentButton disabled={scopeDisabled} pressed={status === 'incomplete'} onClick={() => onStatusChange('incomplete')}>
          未完
        </SegmentButton>
        <SegmentButton disabled={scopeDisabled} pressed={status === 'all'} onClick={() => onStatusChange('all')}>
          両方
        </SegmentButton>
        <SegmentButton disabled={scopeDisabled} pressed={status === 'complete'} onClick={() => onStatusChange('complete')}>
          完了
        </SegmentButton>
      </SegmentGroup>
      <SegmentGroup ariaLabel="割当">
        <SegmentButton disabled={scopeDisabled} pressed={allocation === 'alternate'} onClick={() => onAllocationChange('alternate')}>
          別割当
        </SegmentButton>
        <SegmentButton disabled={scopeDisabled} pressed={allocation === 'original'} onClick={() => onAllocationChange('original')}>
          元割当
        </SegmentButton>
      </SegmentGroup>
      <div className="h-11 min-w-0 flex-1 overflow-hidden">{feedback}</div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
        {onSpecialDueModeChange ? (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="特別納期">
            {(['overnight', 'today'] as const).map((mode) => (
              <div key={mode} className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-pressed={specialDueMode === mode}
                  disabled={specialDueDisabled}
                  className={clsx(
                    'min-h-11 shrink-0 rounded-md border px-2 text-[11px] font-semibold transition-colors',
                    specialDueMode === mode
                      ? 'border-amber-300 bg-amber-400/25 text-amber-100'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-300/70 hover:text-white',
                    specialDueDisabled && 'cursor-not-allowed opacity-55'
                  )}
                  onClick={() => onSpecialDueModeChange(specialDueMode === mode ? null : mode)}
                >
                  {mode === 'overnight' ? '朝まで' : '今日中'}
                </button>
                <span
                  className="mr-1 whitespace-nowrap text-xs font-semibold tabular-nums text-amber-200"
                  aria-label={`${mode === 'overnight' ? '朝まで' : '今日中'}のアイテム件数`}
                  aria-live="polite"
                >
                  {specialDueCounts[mode]}件
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-emerald-300" aria-live="polite">
          {selectedCount}件
        </span>
        <button
          type="button"
          onClick={onOpenDueEditor}
          disabled={bulkDisabled}
          className="min-h-11 shrink-0 rounded-md bg-emerald-400 px-4 text-[13px] font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          一括変更
        </button>
      </div>
    </div>
  );
}
