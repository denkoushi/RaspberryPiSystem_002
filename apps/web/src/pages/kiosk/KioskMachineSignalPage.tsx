import clsx from 'clsx';
import { useMemo, useState } from 'react';

import { useMachineSignalDay } from '../../api/hooks';
import { MachineSignalMachines } from '../../features/machine-signal/MachineSignalMachines';
import { MachineSignalOverview } from '../../features/machine-signal/MachineSignalOverview';
import {
  formatSignalDate,
  SIGNAL_FILTER_HINTS,
  SIGNAL_HINT_LABELS,
  sortSignalMachinesByAttention
} from '../../features/machine-signal/machineSignalViewModel';
import { kioskButtonClass, Segmented } from '../../features/part-measurement/selfInspectionReduction/reductionUi';

import type { MachineSignalHint } from '../../api/client';

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
  const [date, setDate] = useState<string | undefined>(undefined);
  const [site, setSite] = useState(ALL_SITES);
  const [view, setView] = useState<View>('overview');
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<MachineSignalHint | null>(null);

  const dayQuery = useMachineSignalDay({ date, site: site || undefined });
  const day = dayQuery.data;
  const sorted = useMemo(() => sortSignalMachinesByAttention(day?.machines ?? []), [day?.machines]);
  const shown = hint ? sorted.filter((machine) => machine.hint === hint) : sorted;

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
            disabled={!day?.previousDate}
            onClick={() => setDate(day?.previousDate ?? undefined)}
            className={clsx(kioskButtonClass, 'w-11 justify-center px-0')}
          >
            <Arrow direction="left" />
          </button>
          <span className="min-w-[104px] text-center font-mono text-lg font-semibold">
            {day?.reportDate ? formatSignalDate(day.reportDate) : '–'}
          </span>
          <button
            type="button"
            aria-label="次の日"
            disabled={!day?.nextDate}
            onClick={() => setDate(day?.nextDate ?? undefined)}
            className={clsx(kioskButtonClass, 'w-11 justify-center px-0')}
          >
            <Arrow direction="right" />
          </button>
        </div>
        <Segmented label="表示" value={view} options={VIEW_OPTIONS} onChange={setView} />
        {day && day.sites.length > 0 ? (
          <Segmented
            label="工場"
            value={site}
            options={[{ value: ALL_SITES, label: 'すべて' }, ...day.sites.map((name) => ({ value: name, label: name }))]}
            onChange={setSite}
          />
        ) : null}
        {view === 'machines' && day?.fleet ? (
          <div role="group" aria-label="気づきで絞り込み" className="flex flex-wrap gap-1.5">
            {[null, ...SIGNAL_FILTER_HINTS].map((candidate) => (
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
                {candidate ? SIGNAL_HINT_LABELS[candidate] : 'すべて'}
                <b className="font-mono text-[#e6edf5]">{candidate ? day.fleet?.hintCounts[candidate] : day.machines.length}</b>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {dayQuery.isError ? (
        <p role="alert" className="text-[#ff9c99]">
          読み込めませんでした
        </p>
      ) : !day ? (
        <p className="text-[#8b9cb2]">読み込み中…</p>
      ) : !day.reportDate || !day.fleet ? (
        <p className="text-[#8b9cb2]">日報がまだありません</p>
      ) : view === 'overview' ? (
        <MachineSignalOverview day={day} onSelect={openMachine} />
      ) : (
        <MachineSignalMachines day={day} machines={shown} selected={selected} onSelect={setSelected} />
      )}
    </div>
  );
}
