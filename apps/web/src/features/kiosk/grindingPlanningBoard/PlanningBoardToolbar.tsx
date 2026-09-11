import clsx from 'clsx';

import type { PlanningBoardAllocation, PlanningBoardStatus } from './types';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardSpecialDueKind,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';
import type { ReactNode } from 'react';



type SegmentButtonProps = {
  pressed: boolean;
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
};

function SegmentButton({ pressed, children, onClick, ariaLabel }: SegmentButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      className={clsx(
        'min-h-11 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300',
        pressed ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      )}
    >
      {children}
    </button>
  );
}

export type PlanningBoardToolbarProps = {
  category: GrindingPlanningBoardCategory;
  view: GrindingPlanningBoardView;
  status: PlanningBoardStatus;
  allocation: PlanningBoardAllocation;
  selectedCount: number;
  bulkDisabled?: boolean;
  registeredCount: number;
  onOpenDrawer: () => void;
  onCategoryChange: (category: GrindingPlanningBoardCategory) => void;
  onViewChange: (view: GrindingPlanningBoardView) => void;
  onStatusChange: (status: PlanningBoardStatus) => void;
  onAllocationChange: (allocation: PlanningBoardAllocation) => void;
  onOpenDueEditor: () => void;
  specialDueMode?: GrindingPlanningBoardSpecialDueKind | null;
  onSpecialDueModeChange?: (mode: GrindingPlanningBoardSpecialDueKind | null) => void;
  specialDueDisabled?: boolean;
};

export function PlanningBoardToolbar({
  category,
  view,
  status,
  allocation,
  selectedCount,
  bulkDisabled = false,
  registeredCount,
  onOpenDrawer,
  onCategoryChange,
  onViewChange,
  onStatusChange,
  onAllocationChange,
  onOpenDueEditor,
  specialDueMode = null,
  onSpecialDueModeChange,
  specialDueDisabled = false
}: PlanningBoardToolbarProps) {
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-925 px-1.5 py-1.5">
      <button
        type="button"
        onClick={onOpenDrawer}
        className="min-h-11 shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 text-xs font-bold text-slate-200 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        aria-label="製番登録ペインを開く"
      >
        製番 {registeredCount}
      </button>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="工程">
        <SegmentButton pressed={category === 'grinding'} onClick={() => onCategoryChange('grinding')}>
          研削
        </SegmentButton>
        <SegmentButton pressed={category === 'cutting'} onClick={() => onCategoryChange('cutting')}>
          切削
        </SegmentButton>
      </div>
      <span className="h-7 w-px shrink-0 bg-slate-800" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="表示単位">
        <SegmentButton pressed={view === 'seiban'} onClick={() => onViewChange('seiban')}>
          製番
        </SegmentButton>
        <SegmentButton pressed={view === 'resource'} onClick={() => onViewChange('resource')}>
          資源CD
        </SegmentButton>
      </div>
      <span className="h-7 w-px shrink-0 bg-slate-800" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="進捗">
        <SegmentButton pressed={status === 'incomplete'} onClick={() => onStatusChange('incomplete')}>
          未完
        </SegmentButton>
        <SegmentButton pressed={status === 'all'} onClick={() => onStatusChange('all')}>
          両方
        </SegmentButton>
        <SegmentButton pressed={status === 'complete'} onClick={() => onStatusChange('complete')}>
          完了
        </SegmentButton>
      </div>
      <span className="h-7 w-px shrink-0 bg-slate-800" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="割当">
        <SegmentButton pressed={allocation === 'alternate'} onClick={() => onAllocationChange('alternate')}>
          別割当
        </SegmentButton>
        <SegmentButton pressed={allocation === 'original'} onClick={() => onAllocationChange('original')}>
          元割当
        </SegmentButton>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
        {onSpecialDueModeChange ? (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="特別納期">
            {(['overnight', 'today'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={specialDueMode === mode}
                disabled={specialDueDisabled}
                className={clsx(
                  'min-h-9 shrink-0 rounded-md border px-2 text-[11px] font-semibold transition-colors',
                  specialDueMode === mode
                    ? 'border-amber-300 bg-amber-400/25 text-amber-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-300/70 hover:text-white',
                  specialDueDisabled && 'cursor-not-allowed opacity-55'
                )}
                onClick={() => onSpecialDueModeChange(specialDueMode === mode ? null : mode)}
              >
                {mode === 'overnight' ? '朝まで' : '今日中'}
              </button>
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
          className="min-h-11 shrink-0 rounded-md bg-emerald-400 px-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          一括変更
        </button>
      </div>
    </div>
  );
}
