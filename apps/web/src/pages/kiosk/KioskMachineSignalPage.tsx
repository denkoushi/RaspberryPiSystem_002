import clsx from 'clsx';
import { useCallback, useMemo, useState } from 'react';

import { useMachineSignalDay, useMachineSignalRange, useMachineSignalReportDates, useMachineSignalWorsening } from '../../api/hooks';
import { MachineSignalMachines } from '../../features/machine-signal/MachineSignalMachines';
import { MachineSignalOverview } from '../../features/machine-signal/MachineSignalOverview';
import { MachineSignalRangeMachines } from '../../features/machine-signal/MachineSignalRangeMachines';
import { MachineSignalRangeOverview } from '../../features/machine-signal/MachineSignalRangeOverview';
import { sortSignalPinnedMachines } from '../../features/machine-signal/machineSignalRangeViewModel';
import {
  SIGNAL_FILTER_HINTS,
  SIGNAL_HINT_LABELS,
  sortSignalMachinesByAttention
} from '../../features/machine-signal/machineSignalViewModel';
import { SignalDatePicker } from '../../features/machine-signal/SignalDatePicker';
import { formatSignalPickerDay, formatSignalPickerRange } from '../../features/machine-signal/signalDatePickerModel';
import { useSignalPins } from '../../features/machine-signal/signalPins';
import { SignalPinIcon } from '../../features/machine-signal/signalUi';
import { kioskButtonClass, Segmented } from '../../features/part-measurement/selfInspectionReduction/reductionUi';

import type { MachineSignalHint } from '../../api/client';
import type { SignalDateSelection } from '../../features/machine-signal/signalDatePickerModel';

type View = 'overview' | 'machines';
const VIEW_OPTIONS = [
  { value: 'overview', label: '全体' },
  { value: 'machines', label: '機械別' }
] as const;
const ALL_SITES = '';

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** キオスク「設備稼働」。信号灯センサーの日報から、どの機械をどう長く動かせるかを見る。 */
export function KioskMachineSignalPage() {
  const [selection, setSelection] = useState<SignalDateSelection>({ mode: 'latest' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [site, setSite] = useState(ALL_SITES);
  const [view, setView] = useState<View>('overview');
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<MachineSignalHint | 'pins' | null>(null);

  const { pins, toggle } = useSignalPins();
  const date = selection.mode === 'day' ? selection.date : undefined;
  const isRange = selection.mode === 'range';
  const dayQuery = useMachineSignalDay({ date, site: site || undefined });
  const rangeQuery = useMachineSignalRange(isRange ? { from: selection.from, to: selection.to, site: site || undefined } : null);
  const datesQuery = useMachineSignalReportDates();
  const day = dayQuery.data;
  const range = rangeQuery.data;
  const worseningQuery = useMachineSignalWorsening({ date: isRange ? null : day?.reportDate ?? null, site: site || undefined });
  const sorted = useMemo(() => sortSignalPinnedMachines(sortSignalMachinesByAttention(day?.machines ?? []), pins), [day?.machines, pins]);
  const shown = hint === 'pins' ? sorted.filter((machine) => pins.has(machine.signalNo)) : hint ? sorted.filter((machine) => machine.hint === hint) : sorted;
  const rangeSorted = sortSignalPinnedMachines(range?.machines ?? [], pins);
  const rangeShown = hint === 'pins' ? rangeSorted.filter((machine) => pins.has(machine.signalNo)) : rangeSorted;
  const current = isRange ? range : day;
  const pinCount = (current?.machines ?? []).filter((machine) => pins.has(machine.signalNo)).length;
  const emptyMessage = hint === 'pins' ? 'ピン留めした機械がありません' : undefined;
  const activeQuery = isRange ? rangeQuery : dayQuery;

  const chooseDate = (value: SignalDateSelection) => {
    setSelection(value);
    setHint(null);
    setPickerOpen(false);
  };
  const togglePin = (signalNo: number) => {
    const machines = isRange ? rangeShown : shown;
    const active = machines.find((machine) => machine.signalNo === selected) ?? machines[0];
    // 先頭行を暗黙に選んでいた場合も、ピンによる並べ替えで詳細を変えない。
    if (active) setSelected(active.signalNo);
    toggle(signalNo);
  };

  const openMachine = (signalNo: number) => {
    setSelected(signalNo);
    setHint(null);
    setView('machines');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 bg-[#0d1520] p-4 text-[15px] text-[#e6edf5]">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="mr-1 whitespace-nowrap text-[28px] font-black tracking-[0.04em]">設備稼働</h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="前の日"
            disabled={isRange || !day?.previousDate}
            onClick={() => day?.previousDate && chooseDate({ mode: 'day', date: day.previousDate })}
            className={clsx(kioskButtonClass.replace('px-4', 'px-0'), 'w-11 justify-center')}
          >
            <Arrow direction="left" />
          </button>
          <div className="relative">
            <button type="button" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)} className={clsx(kioskButtonClass.replace('text-base', 'text-[17px]'), 'font-mono', pickerOpen && 'ring-1 ring-[#4b8fd6]')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
              {isRange ? formatSignalPickerRange(selection.from, selection.to) : (date ?? day?.reportDate) ? formatSignalPickerDay((date ?? day?.reportDate)!) : '–'}
            </button>
            {pickerOpen ? <SignalDatePicker dates={datesQuery.data ?? []} selection={selection} onSelect={chooseDate} onClose={closePicker} /> : null}
          </div>
          <button
            type="button"
            aria-label="次の日"
            disabled={isRange || !day?.nextDate}
            onClick={() => day?.nextDate && chooseDate({ mode: 'day', date: day.nextDate })}
            className={clsx(kioskButtonClass.replace('px-4', 'px-0'), 'w-11 justify-center')}
          >
            <Arrow direction="right" />
          </button>
        </div>
        {selection.mode !== 'latest' ? <button type="button" onClick={() => chooseDate({ mode: 'latest' })} className="inline-flex h-11 items-center rounded-[9px] border border-[#2c6a4f] bg-[#12301f] px-3.5 text-[15px] font-bold text-[#8be0b4]">最新</button> : null}
        <Segmented label="表示" value={view} options={VIEW_OPTIONS} onChange={setView} />
        {current && current.sites.length > 0 ? (
          <Segmented
            label="工場"
            value={site}
            options={[{ value: ALL_SITES, label: 'すべて' }, ...current.sites.map((name) => ({ value: name, label: name }))]}
            onChange={setSite}
          />
        ) : null}
        {view === 'machines' && current?.fleet ? (
          <div role="group" aria-label="気づきで絞り込み" className="flex flex-wrap gap-1.5">
            {([null, 'pins', ...(isRange ? [] : SIGNAL_FILTER_HINTS)] as const).map((candidate) => (
              <button
                key={candidate ?? 'all'}
                type="button"
                aria-pressed={hint === candidate}
                onClick={() => setHint(candidate)}
                className={clsx(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[15px]',
                  hint === candidate ? 'border-[#4b8fd6] bg-[#1d2b3d] text-[#e6edf5]' : 'border-[#243347] bg-[#141e2b] text-[#8b9cb2]'
                )}
              >
                {candidate === 'pins' ? <span className="text-[#f2c94c]"><SignalPinIcon /></span> : null}
                {candidate === 'pins' ? 'ピン留め' : candidate ? SIGNAL_HINT_LABELS[candidate] : 'すべて'}
                <b className="font-mono text-[#e6edf5]">{candidate === 'pins' ? pinCount : candidate ? day?.fleet?.hintCounts[candidate] : current.machines.length}</b>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {activeQuery.isError ? (
        <p role="alert" className="text-[#ff9c99]">
          読み込めませんでした
        </p>
      ) : !current ? (
        <p className="text-[#8b9cb2]">読み込み中…</p>
      ) : isRange && range ? (
        view === 'overview' ? <MachineSignalRangeOverview range={range} onSelect={openMachine} /> : <MachineSignalRangeMachines range={range} machines={rangeShown} selected={selected} onSelect={setSelected} pins={pins} onTogglePin={togglePin} emptyMessage={emptyMessage} />
      ) : !day?.reportDate || !day.fleet ? (
        <p className="text-[#8b9cb2]">日報がまだありません</p>
      ) : view === 'overview' ? (
        <MachineSignalOverview day={day} worsening={worseningQuery.data ?? []} onSelect={openMachine} />
      ) : (
        <MachineSignalMachines pins={pins} onTogglePin={togglePin} emptyMessage={emptyMessage} day={day} machines={shown} selected={selected} onSelect={setSelected} />
      )}
    </div>
  );
}
