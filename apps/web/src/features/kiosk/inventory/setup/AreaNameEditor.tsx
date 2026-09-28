import { useState } from 'react';

import { AREA_DIRECTIONS, composeArea, DEFAULT_AREA_DIRECTION, splitArea, type AreaDirection } from '../areaNaming';

type Props = {
  title: string;
  /** Area to start from (rename); omitted for a new area. */
  initialArea?: string;
  /** Machines offered as buttons (e.g. those of mailed candidates). */
  machineChoices?: string[];
  confirmLabel: string;
  pending: boolean;
  onConfirm: (area: string) => void;
  onCancel: () => void;
};

const directionOn = 'h-11 w-14 rounded-lg border-2 border-sky-400 bg-sky-950/60 text-base font-bold text-white';
const directionOff = 'h-11 w-14 rounded-lg border border-white/25 bg-slate-800 text-base font-bold text-white/90 hover:bg-slate-700';

/** Machine name (typed or chosen) + 東西南北, previewed before it is saved. */
export function AreaNameEditor({ title, initialArea, machineChoices = [], confirmLabel, pending, onConfirm, onCancel }: Props) {
  const initial = initialArea ? splitArea(initialArea) : { machine: '', direction: null };
  const [machine, setMachine] = useState(initial.machine);
  const [direction, setDirection] = useState<AreaDirection>(initial.direction ?? DEFAULT_AREA_DIRECTION);
  const next = machine.trim() ? composeArea(machine, direction) : '';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-sky-400/70 bg-slate-950 p-3" aria-label={title}>
      <p className="font-bold text-white">{title}</p>
      {machineChoices.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-14 text-sm text-white/60">候補</span>
          {machineChoices.map((choice) => (
            <button key={choice} type="button" className="h-9 rounded-md border border-white/25 bg-slate-800 px-2.5 text-sm text-white hover:bg-slate-700" onClick={() => setMachine(choice)}>{choice}</button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor="area-machine" className="w-14 text-sm text-white/60">加工機</label>
        <input id="area-machine" aria-label="加工機" className="h-10 w-60 rounded-md border border-white/25 bg-slate-900 px-2.5 text-base text-white focus:border-sky-400 focus:outline-none" value={machine} onChange={(event) => setMachine(event.target.value)} />
        <span className="w-3" />
        {AREA_DIRECTIONS.map((entry) => (
          <button key={entry} type="button" aria-pressed={entry === direction} className={entry === direction ? directionOn : directionOff} onClick={() => setDirection(entry)}>{entry}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-sm text-white/60">新しい名前</span>
        <strong className="text-white">{next || '（加工機を入れてください）'}</strong>
        <span className="flex-1" />
        <button type="button" className="h-11 rounded-lg bg-emerald-600 px-4 text-base font-bold text-white hover:bg-emerald-500 disabled:opacity-40" disabled={!next || next === initialArea || pending} onClick={() => onConfirm(next)}>{confirmLabel}</button>
        <button type="button" className="h-11 rounded-lg border border-white/25 px-3.5 text-base text-white hover:bg-slate-800" onClick={onCancel}>やめる</button>
      </div>
    </div>
  );
}
