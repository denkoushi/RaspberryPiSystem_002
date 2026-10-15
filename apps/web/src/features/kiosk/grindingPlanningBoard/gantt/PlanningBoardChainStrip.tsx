import clsx from 'clsx';
import { Fragment } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { ganttResourceLabel } from './ganttResourceLabel';

import type { GanttBar } from './planningBoardGanttLayout';

type Props = {
  bars: GanttBar[];
  resourceNameMap: Record<string, string[]>;
  currentItemId: string | null;
  onStep: (bar: GanttBar) => void;
  onClose: () => void;
};
export function PlanningBoardChainStrip({ bars, resourceNameMap, currentItemId, onStep, onClose }: Props) {
  const part = bars[0]!.item;
  return <div data-testid="planning-gantt-chain-strip" role="region" aria-label="工程のつながり" className="flex items-center gap-3 overflow-x-auto border-b border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
    <div className="shrink-0">
      <strong className="text-base">{part.fhinmei || part.fhincd}</strong>
      <div className="text-sm text-white">{part.fseiban} · {part.fhincd} · {bars.length}工程</div>
    </div>
    {bars.map((bar, index) => <Fragment key={bar.item.itemId}>
      {index > 0 && <span aria-hidden="true" className="text-slate-400">→</span>}
      <button type="button" aria-current={currentItemId === bar.item.itemId ? 'step' : undefined}
        className={clsx('flex min-h-11 shrink-0 items-center gap-2 rounded border border-slate-700 px-2 py-1 text-left', currentItemId === bar.item.itemId && 'ring-2 ring-white')}
        onClick={() => onStep(bar)}>
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-slate-800 font-mono font-bold text-white">{index + 1}</span>
        <strong>工順{bar.item.processOrder} · {ganttResourceLabel(normalizeMachineName(bar.resource), resourceNameMap[bar.resource])}</strong>
      </button>
    </Fragment>)}
    <button type="button" aria-label="工程のつながりを閉じる" className="min-h-11 shrink-0 rounded border border-slate-700 px-3 text-xs" onClick={onClose}>× 閉じる</button>
  </div>;
}
