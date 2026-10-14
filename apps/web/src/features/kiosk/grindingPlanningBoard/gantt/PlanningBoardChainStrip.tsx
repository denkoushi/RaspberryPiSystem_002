import clsx from 'clsx';
import { Fragment } from 'react';

import { normalizeMachineName } from '../../productionSchedule/machineName';

import { ganttResourceLabel } from './ganttResourceLabel';
import { dayLabel } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';

type Props = {
  bars: GanttBar[];
  today: number;
  resourceNameMap: Record<string, string[]>;
  currentItemId: string | null;
  onStep: (bar: GanttBar) => void;
  onClose: () => void;
};
const timeLabel = (day: number, today: number) => {
  const minutes = Math.round(day * 1440);
  const date = Math.floor(minutes / 1440);
  const time = `${Math.floor(minutes % 1440 / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  return `${date === today ? '' : `${dayLabel(date)} `}${time}`;
};

export function PlanningBoardChainStrip({ bars, today, resourceNameMap, currentItemId, onStep, onClose }: Props) {
  const part = bars[0]!.item;
  return <div data-testid="planning-gantt-chain-strip" role="region" aria-label="工程のつながり" className="flex items-center gap-3 overflow-x-auto border-b border-slate-700 bg-slate-950 p-2 text-xs text-slate-100">
    <div className="shrink-0">
      <strong className="text-sm">{part.fhinmei || part.fhincd}</strong>
      <div className="text-[11px] text-slate-400">{part.fseiban} · {part.fhincd} · {bars.length}工程</div>
    </div>
    {bars.map((bar, index) => <Fragment key={bar.item.itemId}>
      {index > 0 && <span aria-hidden="true" className="text-slate-400">→</span>}
      <button type="button" aria-current={currentItemId === bar.item.itemId ? 'step' : undefined}
        className={clsx('flex min-h-11 shrink-0 items-center gap-2 rounded border border-slate-700 px-2 py-1 text-left', currentItemId === bar.item.itemId && 'ring-2 ring-white')}
        onClick={() => onStep(bar)}>
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-slate-800 font-mono font-bold text-white">{index + 1}</span>
        <span><strong className="block">工順{bar.item.processOrder} · {ganttResourceLabel(normalizeMachineName(bar.resource), resourceNameMap[bar.resource])}</strong>
          <span className="text-[11px] text-slate-400">{bar.unknown ? '所要不明' : `${timeLabel(bar.start!, today)}〜${timeLabel(bar.end!, today)}`} <span className={clsx(bar.tone === 'late' && 'text-rose-400')}>{bar.tone === 'late' ? '遅れ見込み' : '予定'}</span></span>
        </span>
      </button>
    </Fragment>)}
    <button type="button" aria-label="工程のつながりを閉じる" className="min-h-11 shrink-0 rounded border border-slate-700 px-3 text-xs" onClick={onClose}>× 閉じる</button>
  </div>;
}
