import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PlanningBoardPinIcon } from './gantt/PlanningBoardPinIcon';
import { GANTT_SCALES, ganttScaleLabel } from './gantt/usePersistedPlanningBoardGanttScale';
import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';
import { pageZoom } from './pageZoom';
import { PlanningBoardDropdown } from './PlanningBoardDropdown';
import { PlanningBoardOrderScan } from './PlanningBoardOrderScan';
import { PlanningBoardSingleResourcePicker } from './PlanningBoardSingleResourcePicker';

import type { PlanningBoardOrderMetrics } from './gantt/planningBoardAutoOrder';
import type { PlanningBoardGanttMode } from './gantt/usePersistedPlanningBoardGanttMode';
import type { PlanningBoardGanttScale } from './gantt/usePersistedPlanningBoardGanttScale';
import type { PlanningBoardAllocation, PlanningBoardStatus } from './types';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardScheduleSource,
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
        tone === 'scale' && 'min-w-11',
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
  onOrderScan?: (productNo: string) => string | null;
  focusedSeiban?: string | null;
  onClearSeibanFocus?: () => void;
  largeScreen?: boolean;
  onToggleLargeScreen?: () => void;
  arrivalFilterEnabled?: boolean;
  onToggleArrivalFilter?: () => void;
  scawEnabled?: boolean;
  onToggleScawMode?: () => void;
  singleResourceCd?: string | null;
  singleResourceLanes?: readonly string[];
  singleResourceNameMap?: Record<string, string[]>;
  singleResourcePickerAnchor?: HTMLElement | null;
  onOpenSingleResourcePicker?: (anchor: HTMLElement) => void;
  onCloseSingleResourcePicker?: () => void;
  onSingleResourceChange?: (resource: string | null) => void;
  ganttEnabled?: boolean;
  onToggleGantt?: () => void;
  colorBySeiban?: boolean;
  onToggleColorBySeiban?: () => void;
  ganttScale?: PlanningBoardGanttScale;
  onGanttScaleChange?: (scale: PlanningBoardGanttScale) => void;
  ganttMode?: PlanningBoardGanttMode;
  onGanttModeChange?: (mode: PlanningBoardGanttMode) => void;
  lateCount?: number;
  onNextLate?: () => void;
  onProposeOrder?: () => void;
  onSortDue?: () => void;
  pinMode?: boolean;
  onTogglePinMode?: () => void;
  orderPreview?: { before: PlanningBoardOrderMetrics; after: PlanningBoardOrderMetrics } | null;
  previewPending?: boolean;
  onApplyOrder?: () => void;
  onCancelOrder?: () => void;
  onUndoOrder?: () => void;
  orderDisabled?: boolean;
  canUndoOrder?: boolean;
  overlapCount?: number;
  onNextOverlap?: () => void;
  scheduleSource?: GrindingPlanningBoardScheduleSource;
  onScheduleSourceChange?: (source: GrindingPlanningBoardScheduleSource) => void;
  category: GrindingPlanningBoardCategory;
  view: GrindingPlanningBoardView;
  status: PlanningBoardStatus;
  allocation: PlanningBoardAllocation;
  selectedCount: number;
  bulkDisabled?: boolean;
  scopeDisabled?: boolean;
  registeredCount: number;
  feedback?: ReactNode;
  onOpenDrawer: () => void;
  onCategoryChange: (category: GrindingPlanningBoardCategory) => void;
  onViewChange: (view: GrindingPlanningBoardView) => void;
  onStatusChange: (status: PlanningBoardStatus) => void;
  onAllocationChange: (allocation: PlanningBoardAllocation) => void;
  onOpenDueEditor: () => void;
  specialDueMode?: GrindingPlanningBoardSpecialDueKind | null;
  onSpecialDueModeChange?: (mode: GrindingPlanningBoardSpecialDueKind | null) => void;
  specialDueDisabled?: boolean;
  specialDueCounts?: Record<GrindingPlanningBoardSpecialDueKind, number>;
};

const formatWait = (minutes: number) => `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, '0')}分`;

export function PlanningBoardToolbar({
  scheduleSource = 'both', onScheduleSourceChange,
  onOrderScan, focusedSeiban = null, onClearSeibanFocus,
  largeScreen = false, onToggleLargeScreen,
  scawEnabled = false, onToggleScawMode,
  arrivalFilterEnabled = true, onToggleArrivalFilter,
  singleResourceCd = null, singleResourceLanes = [], singleResourceNameMap = {}, singleResourcePickerAnchor = null,
  onOpenSingleResourcePicker, onCloseSingleResourcePicker, onSingleResourceChange,
  ganttEnabled = false,
  onToggleGantt,
  colorBySeiban = false, onToggleColorBySeiban,
  ganttScale = 14,
  onGanttScaleChange,
  ganttMode = 'forward', onGanttModeChange, lateCount = 0, onNextLate,
  pinMode = false, onTogglePinMode, orderPreview, previewPending = false, onApplyOrder, onCancelOrder,
  onProposeOrder, onSortDue, onUndoOrder, orderDisabled = false, canUndoOrder = false,
  overlapCount = 0,
  onNextOverlap,
  category,
  view,
  status,
  allocation,
  selectedCount,
  bulkDisabled = false,
  scopeDisabled = false,
  registeredCount,
  feedback,
  onOpenDrawer,
  onCategoryChange,
  onViewChange,
  onStatusChange,
  onAllocationChange,
  onOpenDueEditor,
  specialDueMode = null,
  onSpecialDueModeChange,
  specialDueDisabled = false,
  specialDueCounts = { overnight: 0, today: 0 }
}: PlanningBoardToolbarProps) {
  const { frozen } = usePlanningBoardOffline();
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scalePosition, setScalePosition] = useState({ left: 8, top: 8 });
  const scaleButton = useRef<HTMLButtonElement>(null);
  const scalePanel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (singleResourcePickerAnchor) setScaleOpen(false); }, [singleResourcePickerAnchor]);
  const hiddenScale = ganttScale > 2;
  useEffect(() => { if (!ganttEnabled) setScaleOpen(false); }, [ganttEnabled]);
  // Follow the queue popover pattern; a portal avoids the toolbar's scroll clipping.
  useEffect(() => {
    if (!scaleOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !scalePanel.current?.contains(event.target) && !scaleButton.current?.contains(event.target)) setScaleOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); setScaleOpen(false); scaleButton.current?.focus(); }
    };
    const close = () => setScaleOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [scaleOpen]);
  useLayoutEffect(() => {
    if (!scaleOpen || !scaleButton.current || !scalePanel.current) return;
    const anchor = scaleButton.current.getBoundingClientRect();
    const panel = scalePanel.current.getBoundingClientRect();
    const zoom = pageZoom();
    setScalePosition({ left: Math.max(8, Math.min(anchor.left / zoom, (window.innerWidth - panel.width) / zoom - 8)),
      top: Math.max(8, Math.min(anchor.bottom / zoom + 4, (window.innerHeight - panel.height) / zoom - 8)) });
    (scalePanel.current.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? scalePanel.current.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [scaleOpen]);
  return (
    <div className="[&_button[aria-disabled=true]]:opacity-55 flex h-[66px] min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg border border-slate-800 bg-slate-925 px-2 py-1.5">
      <button
        type="button"
        onClick={onOpenDrawer}
        disabled={Boolean(orderPreview)}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-slate-500 bg-slate-800 pl-3 pr-2 text-[13px] font-bold text-slate-100 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        aria-label="製番登録ペインを開く"
      >
        製番
        <span className="min-w-6 rounded-full bg-slate-950 px-1.5 py-0.5 text-center tabular-nums text-emerald-300">{registeredCount}</span>
      </button>
      <PlanningBoardDropdown ariaLabel="区分" value={scheduleSource}
        closedLabel={scheduleSource === 'both' ? '一般・D社' : scheduleSource === 'general' ? '一般' : 'D社'}
        options={[{ value: 'general', label: '一般' }, { value: 'dCompany', label: 'D社' }, { value: 'both', label: '両方' }]}
        disabled={scopeDisabled} onChange={(value) => onScheduleSourceChange?.(value)} />
      <PlanningBoardDropdown ariaLabel="工程" value={category}
        closedLabel={category === 'all' ? '切削・研削' : category === 'cutting' ? '切削' : '研削'}
        options={[{ value: 'cutting', label: '切削' }, { value: 'grinding', label: '研削' }, { value: 'all', label: '両方' }]}
        disabled={scopeDisabled} onChange={onCategoryChange} />
      <button type="button" aria-label="前工程が済んだものだけ表示" aria-pressed={arrivalFilterEnabled}
        onClick={onToggleArrivalFilter} disabled={Boolean(orderPreview)}
        className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border text-base font-bold', arrivalFilterEnabled ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>着</button>
      <SegmentGroup ariaLabel="表示単位">
        <SegmentButton disabled={Boolean(orderPreview)} pressed={view === 'seiban'} onClick={() => onViewChange('seiban')}>
          製番
        </SegmentButton>
        <SegmentButton disabled={Boolean(orderPreview)} pressed={view === 'resource'} onClick={() => onViewChange('resource')}>
          資源CD
        </SegmentButton>
      </SegmentGroup>
      {onToggleGantt && <div className={clsx(SEGMENT_TRACK_CLASS, 'border-sky-400/55 bg-sky-400/10')}>
        <SegmentButton tone="gantt" disabled={Boolean(orderPreview)} pressed={ganttEnabled} onClick={onToggleGantt}>
          ガント
        </SegmentButton>
        {ganttEnabled && <>
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="並べ方">
            <span className="px-1 text-[10px] text-slate-400">並べ方</span>
            <SegmentButton tone="gantt" disabled={Boolean(orderPreview)} pressed={ganttMode === 'forward'} onClick={() => onGanttModeChange?.('forward')}>今日から</SegmentButton>
            <SegmentButton tone="gantt" disabled={Boolean(orderPreview)} pressed={ganttMode === 'backward'} onClick={() => onGanttModeChange?.('backward')}>納期から</SegmentButton>
          </div>
          <div className="ml-1 flex shrink-0 items-center gap-0.5" role="group" aria-label="横軸の幅">
            {GANTT_SCALES.filter((days) => days <= 2).map((days) => <SegmentButton key={days} tone="scale" pressed={ganttScale === days} onClick={() => onGanttScaleChange?.(days)}>{ganttScaleLabel(days)}</SegmentButton>)}
            <button ref={scaleButton} type="button" aria-label="他の幅" aria-expanded={scaleOpen} aria-pressed={hiddenScale}
              onClick={() => { onCloseSingleResourcePicker?.(); setScaleOpen((open) => !open); }}
              className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border text-xs font-bold', hiddenScale ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
              {hiddenScale ? `${ganttScaleLabel(ganttScale)} ▾` : <span className="text-2xl">⋯</span>}
            </button>
            {scaleOpen && createPortal(<div ref={scalePanel} data-planning-board-popover role="group" aria-label="他の幅" style={scalePosition}
              className="fixed z-[100] flex flex-wrap gap-0.5 rounded-lg border border-slate-600 bg-slate-900 p-1 shadow-xl">
              {GANTT_SCALES.filter((days) => days > 2).map((days) => <SegmentButton key={days} tone="scale" pressed={ganttScale === days}
                onClick={() => { onGanttScaleChange?.(days); setScaleOpen(false); scaleButton.current?.focus(); }}>{ganttScaleLabel(days)}</SegmentButton>)}
            </div>, document.body)}
          </div>
          {onSingleResourceChange && <button type="button" aria-pressed={Boolean(singleResourceCd)} aria-expanded={Boolean(singleResourcePickerAnchor)}
            aria-label={singleResourceCd ? `${singleResourceCd} 1台表示をやめる` : '1台'} disabled={Boolean(orderPreview)}
            onClick={(event) => { setScaleOpen(false); if (singleResourceCd) onSingleResourceChange(null); else onOpenSingleResourcePicker?.(event.currentTarget); }}
            className={clsx('h-[46px] shrink-0 rounded-md border px-3 text-[13px] font-bold', singleResourceCd ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
            {singleResourceCd ? `${singleResourceCd} ✕` : '1台'}
          </button>}
          {singleResourcePickerAnchor && onSingleResourceChange && onCloseSingleResourcePicker && <PlanningBoardSingleResourcePicker
            anchor={singleResourcePickerAnchor} resources={singleResourceLanes} resourceCd={singleResourceCd} resourceNameMap={singleResourceNameMap}
            onSelect={onSingleResourceChange} onClose={onCloseSingleResourcePicker} />}
          <button type="button" aria-label="製番ごとに色分け" aria-pressed={colorBySeiban} onClick={onToggleColorBySeiban}
            className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border', colorBySeiban ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h3a6 6 0 0 0 0-12Z" />
              <circle cx="7" cy="10" r="1" /><circle cx="10" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="18" cy="10" r="1" />
            </svg>
          </button>
        </>}
      </div>}
      {!orderPreview && <button type="button" aria-pressed={scawEnabled} onClick={onToggleScawMode}
        className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border text-[11px] font-bold', scawEnabled ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>SCAW</button>}
      {onOrderScan && <PlanningBoardOrderScan onScan={onOrderScan} />}
      {!ganttEnabled && focusedSeiban && <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-600 pl-2 text-sm">
        <span>製番 {focusedSeiban}</span>
        <button type="button" aria-label="目立たせるのをやめる" onClick={onClearSeibanFocus} className="grid h-11 w-11 place-items-center">✕</button>
      </div>}
      {ganttEnabled && <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={ganttMode === 'forward' ? onNextLate : onNextOverlap}
            className={clsx('ml-1 min-h-11 shrink-0 rounded-md px-2 text-[13px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300', (ganttMode === 'forward' ? lateCount : overlapCount) ? 'bg-rose-800 text-white' : 'text-emerald-300')}>
            {ganttMode === 'forward' ? (lateCount ? `遅れ ${lateCount}` : '遅れなし') : (overlapCount ? `重なり ${overlapCount}` : '重なりなし')}
          </button>
          {ganttMode === 'forward' && view === 'resource' && (orderPreview ? <>
            <div className="flex shrink-0 flex-col rounded-md border border-amber-400 px-2 py-1 text-xs tabular-nums" role="status" aria-label="並べ替えの比較">
              <span>遅れ {orderPreview.before.lateCount} → <b className={clsx(orderPreview.after.lateCount < orderPreview.before.lateCount && 'text-emerald-300')}>{orderPreview.after.lateCount}</b> 件</span>
              <span>待ち {formatWait(orderPreview.before.waitMinutes)} → <b className={clsx(orderPreview.after.waitMinutes < orderPreview.before.waitMinutes && 'text-emerald-300')}>{formatWait(orderPreview.after.waitMinutes)}</b></span>
            </div>
            <button type="button" aria-disabled={frozen || undefined} onClick={onApplyOrder} disabled={previewPending}
              className="min-h-11 shrink-0 rounded-md bg-emerald-400 px-3 text-[13px] font-bold text-slate-950 disabled:opacity-40">適用</button>
            <button type="button" onClick={onCancelOrder} disabled={previewPending}
              className="min-h-11 shrink-0 rounded-md border border-slate-600 px-3 text-[13px] font-bold text-slate-200 disabled:opacity-40">やめる</button>
          </> : <>
            <button type="button" aria-label="固定" aria-disabled={frozen || undefined} aria-pressed={pinMode} onClick={onTogglePinMode} disabled={orderDisabled}
              className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border disabled:opacity-40', pinMode ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
              <PlanningBoardPinIcon />
            </button>
            <button type="button" aria-disabled={frozen || undefined} onClick={onProposeOrder} disabled={allocation !== 'alternate' || orderDisabled}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-slate-600 px-2 text-[13px] font-bold text-sky-300 disabled:opacity-40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true"><path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4" /></svg>並べ替え
            </button>
          </>)}
          {!orderPreview && <button type="button" aria-label="納期順に並べる" aria-disabled={frozen || undefined} onClick={onSortDue}
            disabled={ganttMode !== 'forward' || allocation !== 'alternate' || orderDisabled}
            className="min-h-11 shrink-0 rounded-md bg-emerald-900 px-2 text-[13px] font-bold text-emerald-100 disabled:opacity-40">納期順</button>}
          <button type="button" aria-disabled={frozen || undefined} onClick={onUndoOrder}
            disabled={ganttMode !== 'forward' || allocation !== 'alternate' || orderDisabled || !canUndoOrder}
            className="min-h-11 shrink-0 rounded-md border border-slate-600 px-2 text-[13px] font-bold text-slate-200 disabled:opacity-40">↶ 戻す</button>
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
                  aria-disabled={frozen || undefined}
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
          aria-disabled={frozen || undefined}
          onClick={onOpenDueEditor}
          disabled={bulkDisabled}
          className="min-h-11 shrink-0 rounded-md bg-emerald-400 px-4 text-[13px] font-bold text-slate-950 hover:bg-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
        >
          一括変更
        </button>
      </div>
      <button type="button" aria-label="50インチ表示" aria-pressed={largeScreen} onClick={onToggleLargeScreen}
        className={clsx('ml-auto grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border', largeScreen ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
          <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4m-4 0h8" />
        </svg>
      </button>
    </div>
  );
}
