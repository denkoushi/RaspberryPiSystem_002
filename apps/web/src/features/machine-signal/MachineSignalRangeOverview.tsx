import clsx from 'clsx';

import { PickPanel } from './MachineSignalOverview';
import { buildSignalRangePick, formatSignalAverageRun, signalRangeHeatColor, signalRunRatio } from './machineSignalRangeViewModel';
import { formatSignalLimit } from './machineSignalViewModel';
import { formatSignalShortDate } from './signalDatePickerModel';
import { SignalLossBand, signalPanelClass } from './signalUi';

import type { MachineSignalRange } from '../../api/client';

export function SignalDailyRunBars({ dates, ratios }: { dates: string[]; ratios: number[] }) {
  return <div>
    <h3 className="mb-2 text-base font-bold">日ごとの稼働</h3>
    <div role="img" aria-label="日ごとの稼働" className="grid h-[90px] auto-cols-fr grid-flow-col items-end gap-0.5 border-b border-[#243347]">
      {dates.map((date, index) => <i key={date} title={`${formatSignalShortDate(date)} ${Math.round((ratios[index] ?? 0) * 100)}%`} className="rounded-t-sm bg-[#35b37e]" style={{ height: `${Math.max(0, Math.min(1, ratios[index] ?? 0)) * 100}%` }} />)}
    </div>
    <div className="mt-1 flex justify-between font-mono text-xs text-[#8b9cb2]"><span>{dates[0] && formatSignalShortDate(dates[0])}</span><span>{dates.at(-1) && formatSignalShortDate(dates.at(-1)!)}</span></div>
  </div>;
}

export function MachineSignalRangeOverview({ range, onSelect }: { range: MachineSignalRange; onSelect: (signalNo: number) => void }) {
  const { fleet } = range;
  const byNo = new Map(range.machines.map((machine) => [machine.signalNo, machine]));
  const picks = (numbers: number[], kind: 'alarm' | 'short' | 'long') => numbers.flatMap((number) => {
    const machine = byNo.get(number);
    return machine ? [buildSignalRangePick(machine, kind)] : [];
  });
  return <div className="flex min-h-0 flex-1 flex-col gap-2.5">
    <section className={clsx(signalPanelClass, 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-7 gap-y-2 px-4 py-3')}>
      <div>
        <div className="font-mono text-[64px] font-semibold leading-none text-[#35b37e]">{Math.round(fleet.runRatio * 100)}<small className="ml-0.5 text-2xl">%</small></div>
        <div className="mt-1.5 text-[13px] text-[#8b9cb2]">{fleet.machineCount}台 × {fleet.dayCount}日のうち稼働{fleet.estimatedKwh !== null ? ` ・ 推定 ${Math.round(fleet.estimatedKwh).toLocaleString()} kWh` : ''}</div>
      </div>
      <SignalLossBand loss={fleet.loss} thresholds={range.thresholds} />
    </section>
    <div className="grid gap-2.5 min-[1100px]:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
      <section className={clsx(signalPanelClass, 'px-4 py-3')}><SignalDailyRunBars dates={range.dates} ratios={fleet.dailyRunRatio} /></section>
      <PickPanel title="赤ランプが長い" note="合計" color="#ef5350" picks={picks(fleet.topAlarm, 'alarm')} onSelect={onSelect} />
      <PickPanel title="細かく止まる" note={`${formatSignalLimit(range.thresholds.shortStopMaxSeconds)}以下`} color="#f3e7a0" picks={picks(fleet.topShortStops, 'short')} onSelect={onSelect} />
      <PickPanel title="長く止まった" note="1回の最長" color="#a58c2a" picks={picks(fleet.topLongStop, 'long')} onSelect={onSelect} />
    </div>
    <section className={clsx(signalPanelClass, 'px-4 py-3')}>
      <h2 className="mb-2 text-base font-bold">全機械</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5">
        {range.machines.map((machine) => <button key={machine.signalNo} type="button" onClick={() => onSelect(machine.signalNo)} className={clsx('grid min-w-0 gap-0.5 rounded-md px-[9px] py-[7px] text-left', machine.recordDays ? 'text-[#e6edf5]' : 'text-[#5d6e84]')} style={{ backgroundColor: signalRangeHeatColor(machine.recordDays ? signalRunRatio(machine.averageRunSecondsPerDay) : null) }}>
          <span className="truncate text-[13px] font-semibold">{machine.name}</span>
          <span className="font-mono text-base font-semibold">{machine.recordDays ? formatSignalAverageRun(machine.averageRunSecondsPerDay) : '記録なし'}</span>
        </button>)}
      </div>
    </section>
  </div>;
}
