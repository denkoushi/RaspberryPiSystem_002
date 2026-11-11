import clsx from 'clsx';
import { Fragment } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';
import { PlanningBoardCompletionButton } from '../PlanningBoardCompletionButton';
import { PlanningBoardPiecePopover } from '../PlanningBoardPiecePopover';

import { ganttResourceLabel } from './ganttResourceLabel';

import type { NormalGanttBar as GanttBar } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { Ref } from 'react';

type Props = {
  ref?: Ref<HTMLDivElement>;
  bottom: number;
  selectedItemIds: ReadonlySet<string>;
  onCompleteToggle?: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete') => void;
  completionPendingItemIds?: ReadonlySet<string>;
  disabled?: boolean;
  pieceDisabled?: boolean;
  bars: GanttBar[];
  resourceNameMap: Record<string, string[]>;
  currentItemId: string | null;
  onStep: (bar: GanttBar) => void;
  onClose: () => void;
};
export function PlanningBoardChainStrip({ ref, bottom, selectedItemIds, bars, resourceNameMap, currentItemId, onStep, onClose, onCompleteToggle, completionPendingItemIds, disabled, pieceDisabled }: Props) {
  const part = bars[0]!.item;
  const processPositions = new Map<string, number>();
  const positions = bars.map(({ item }) => {
    const key = item.kind === 'piece' && item.parentItemId ? item.parentItemId : item.itemId;
    if (!processPositions.has(key)) processPositions.set(key, processPositions.size + 1);
    return processPositions.get(key)!;
  });
  const processCount = processPositions.size;
  return <div ref={ref} style={{ bottom }} data-testid="planning-gantt-chain-strip" role="region" aria-label="工程のつながり" className="absolute inset-x-0 z-50 flex items-center gap-3 overflow-x-auto border-t border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
    <div className="shrink-0">
      <strong className="text-base">{part.fhinmei || part.fhincd}</strong>
      <div className="text-sm text-white">{part.fseiban} · {part.fhincd} · {processCount}工程</div>
    </div>
    {bars.map((bar, index) => <Fragment key={bar.item.itemId}>
      {index > 0 && (bars[index - 1]!.item.parentItemId ?? bars[index - 1]!.item.itemId) !== (bar.item.parentItemId ?? bar.item.itemId) && <span aria-hidden="true" className="text-slate-400">→</span>}
      <button type="button" aria-current={currentItemId === bar.item.itemId ? 'step' : undefined}
        className={clsx('flex min-h-11 shrink-0 items-center gap-2 rounded border border-slate-700 px-2 py-1 text-left', currentItemId === bar.item.itemId && 'ring-2 ring-white')}
        onClick={() => onStep(bar)}>
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-slate-800 font-mono font-bold text-white">{positions[index]}</span>
        <strong>工順{bar.item.processOrder} · {ganttResourceLabel(normalizeMachineName(bar.resource), resourceNameMap[bar.resource])}</strong>
      </button>
      <PlanningBoardPiecePopover item={bar.item} variant="gantt" selected={selectedItemIds.has(bar.item.itemId)} disabled={pieceDisabled || disabled || completionPendingItemIds?.has(bar.item.itemId)} />
      {onCompleteToggle && <PlanningBoardCompletionButton item={bar.item} onToggle={onCompleteToggle}
        disabled={disabled || completionPendingItemIds?.has(bar.item.itemId)} />}
    </Fragment>)}
    <button type="button" aria-label="工程のつながりを閉じる" className="min-h-11 shrink-0 rounded border border-slate-700 px-3 text-xs" onClick={onClose}>× 閉じる</button>
  </div>;
}
