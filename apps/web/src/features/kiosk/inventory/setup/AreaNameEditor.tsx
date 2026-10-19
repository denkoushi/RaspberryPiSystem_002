import { useState } from 'react';

import { AREA_DIRECTIONS, composeArea, DEFAULT_AREA_DIRECTION, splitArea, type AreaDirection } from '../areaNaming';
import { invButtonGhost, invButtonGo, invButtonSm, invField, invLabel, invSeg } from '../inventoryUi';

type Props = {
  title: string;
  /** Area to start from (rename); omitted for a new area. */
  initialArea?: string;
  /** Machines offered as buttons (e.g. those of mailed candidates). */
  machineChoices?: string[];
  confirmLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: (area: string) => void;
  onCancel: () => void;
};

/** Machine name (typed or chosen) + 東西南北, previewed before it is saved. */
export function AreaNameEditor({ title, initialArea, machineChoices = [], confirmLabel, pending, error, onConfirm, onCancel }: Props) {
  const initial = initialArea ? splitArea(initialArea) : { machine: '', direction: null };
  const [machine, setMachine] = useState(initial.machine);
  const [direction, setDirection] = useState<AreaDirection>(initial.direction ?? DEFAULT_AREA_DIRECTION);
  const next = machine.trim() ? composeArea(machine, direction) : '';

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-inv-cyan/50 bg-inv-s1 p-4" aria-label={title}>
      <p className="font-black">{title}</p>
      {machineChoices.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${invLabel} w-14`}>候補</span>
          {machineChoices.map((choice) => (
            <button key={choice} type="button" className={invButtonSm} onClick={() => setMachine(choice)}>{choice}</button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor="area-machine" className={`${invLabel} w-14`}>加工機</label>
        <input id="area-machine" aria-label="加工機" className={`${invField} w-60`} value={machine} onChange={(event) => setMachine(event.target.value)} />
        <span className="w-3" />
        {AREA_DIRECTIONS.map((entry) => (
          <button key={entry} type="button" aria-pressed={entry === direction} className={invSeg(entry === direction)} onClick={() => setDirection(entry)}>{entry}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={invLabel}>新しい名前</span>
        <strong>{next || '（加工機を入れてください）'}</strong>
        <span className="flex-1" />
        <button type="button" className={invButtonGo} disabled={!next || next === initialArea || pending} onClick={() => onConfirm(next)}>{confirmLabel}</button>
        <button type="button" className={invButtonGhost} onClick={onCancel}>やめる</button>
      </div>
      <div className="h-8 overflow-hidden text-sm leading-4">{error ? <p role="alert" className="line-clamp-2 text-[#ffd0d0]">{error}</p> : null}</div>
    </div>
  );
}
