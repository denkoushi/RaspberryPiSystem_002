import clsx from 'clsx';
import { useEffect, useRef } from 'react';

import { SignalDailyRunBars } from './MachineSignalRangeOverview';
import { buildSignalRangeAxis, formatSignalAverageRun, formatSignalRangeStopStart, signalRangeHeatColor, signalRunRatio } from './machineSignalRangeViewModel';
import { formatSignalDuration } from './machineSignalViewModel';
import { SignalLossBand, SignalPinButton, signalPanelClass } from './signalUi';

import type { MachineSignalRange, MachineSignalRangeMachine } from '../../api/client';

const ROW_GRID = 'grid grid-cols-[30px_minmax(0,1fr)] items-center gap-2 px-2.5';
const DATA_GRID = 'grid grid-cols-[30px_168px_minmax(0,1fr)_78px_70px] items-center gap-2';

function RangeMachineDetail({ machine, range }: { machine: MachineSignalRangeMachine; range: MachineSignalRange }) {
  const stop = machine.longestStop;
  const values = [
    ['稼働/日', formatSignalAverageRun(machine.averageRunSecondsPerDay)],
    ['停止', `${machine.stopCount}回`],
    ['短い停止', `${machine.shortStopCount}回`],
    ['赤ランプ', `${machine.alarmCount}回`],
    ['記録のある日', `${machine.recordDays}/${range.dates.length}日`]
  ];
  return <section className={clsx(signalPanelClass, 'flex min-h-0 flex-col gap-3.5 px-4 py-3.5')}>
    <div>
      <h2 className="text-xl font-bold">{machine.name}</h2>
      <p className="mt-0.5 text-xs text-[#8b9cb2]">{[machine.site, machine.name !== machine.sourceMachineName ? machine.sourceMachineName : null, `Signal ${machine.signalNo}`].filter(Boolean).join(' ・ ')}</p>
    </div>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2">
      {values.map(([label, value]) => <div key={label} className="rounded-lg border border-[#243347] px-2.5 py-2"><span className="block text-xs text-[#8b9cb2]">{label}</span><b className="font-mono text-2xl font-semibold">{value}</b></div>)}
    </div>
    <SignalDailyRunBars dates={range.dates} ratios={machine.days.map((day) => signalRunRatio(day?.runSeconds ?? null))} />
    <div><h3 className="mb-2 text-base font-bold">時間の行き先</h3><SignalLossBand loss={machine.loss} thresholds={range.thresholds} /></div>
    <div><h3 className="mb-1.5 text-base font-bold">最長の停止</h3><p className="text-sm">{stop ? `${formatSignalRangeStopStart(stop)} から ・ ${formatSignalDuration(stop.durationSeconds)} ・ ${stop.stateName}` : 'なし'}</p></div>
  </section>;
}

export function MachineSignalRangeMachines({ range, machines, selected, onSelect, pins, onTogglePin, emptyMessage }: {
  range: MachineSignalRange;
  machines: MachineSignalRangeMachine[];
  selected: number | null;
  onSelect: (signalNo: number) => void;
  pins: ReadonlySet<number>;
  onTogglePin: (signalNo: number) => void;
  emptyMessage?: string;
}) {
  const machine = machines.find((candidate) => candidate.signalNo === selected) ?? machines[0];
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => { selectedRow.current?.scrollIntoView?.({ block: 'nearest' }); }, [machine?.signalNo]);
  return <div className="grid min-h-0 flex-1 gap-2.5 min-[1100px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
    <section className={clsx(signalPanelClass, 'flex min-h-0 flex-col')}>
      <div className={clsx(ROW_GRID, 'h-[34px] shrink-0 border-b border-[#243347] text-[13px] text-[#8b9cb2]')}>
        <span /><div className={DATA_GRID}><span /><span>機械</span>
          <div className="relative h-4 font-mono text-xs">{buildSignalRangeAxis(range.dates).map((tick, index, ticks) => <span key={tick.position} className={clsx('absolute whitespace-nowrap', index === 0 ? '' : index === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${tick.position * 100}%` }}>{tick.label}</span>)}</div>
          <span className="text-right">稼働/日</span><span className="text-right">停止</span>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {machines.length === 0 && emptyMessage ? <p className="p-4 text-[#8b9cb2]">{emptyMessage}</p> : null}
        {machines.map((item) => {
          const active = item.signalNo === machine?.signalNo;
          return <div key={item.signalNo} ref={active ? selectedRow : undefined} className={clsx(ROW_GRID, 'h-[30px] border-b border-[#1b2736] text-[15px] hover:bg-[#18232f]', active && 'bg-[#1d2b3d]')}>
            <SignalPinButton name={item.name} pinned={pins.has(item.signalNo)} onToggle={() => onTogglePin(item.signalNo)} />
            <button type="button" aria-current={active} onClick={() => onSelect(item.signalNo)} className={clsx(DATA_GRID, 'h-full min-w-0 text-left')}>
              <span className="text-right font-mono text-xs text-[#5d6e84]">{item.signalNo}</span><span className="truncate font-semibold">{item.name}</span>
              <span role="img" aria-label={`${item.name} の日ごとの稼働`} className="grid h-4 auto-cols-fr grid-flow-col gap-px">
                {range.dates.map((date, index) => <i key={date} title={date} className="rounded-[1.5px]" style={{ backgroundColor: signalRangeHeatColor(item.days[index] ? signalRunRatio(item.days[index]!.runSeconds) : null) }} />)}
              </span>
              <span className="text-right font-mono">{formatSignalAverageRun(item.averageRunSecondsPerDay)}</span><span className="text-right font-mono">{item.stopCount}<small className="ml-px text-[11px] text-[#8b9cb2]">回</small></span>
            </button>
          </div>;
        })}
      </div>
    </section>
    {machine ? <RangeMachineDetail machine={machine} range={range} /> : <section className={signalPanelClass} />}
  </div>;
}
