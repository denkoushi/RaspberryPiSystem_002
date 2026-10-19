import clsx from 'clsx';

import { buildSignalLossSlices, formatSignalHours, SIGNAL_HINT_CLASSES, SIGNAL_HINT_LABELS, splitSignalDuration } from './machineSignalViewModel';

import type { MachineSignalHint, MachineSignalLoss, MachineSignalThresholds } from '../../api/client';
import type { ReactNode } from 'react';

export const signalPanelClass = 'min-w-0 rounded-[10px] border border-[#243347] bg-[#141e2b]';

export function HintTag({ hint, className }: { hint: MachineSignalHint; className?: string }) {
  if (hint === 'NONE') return null;
  return (
    <span className={clsx('whitespace-nowrap rounded px-[7px] py-0.5 text-xs font-bold', SIGNAL_HINT_CLASSES[hint], className)}>
      {SIGNAL_HINT_LABELS[hint]}
    </span>
  );
}

/** 数値と単位。単位は小さく薄く出す。 */
export function Quantity({ value, unit }: { value: ReactNode; unit: string }) {
  return (
    <>
      {value}
      <small className="ml-px font-sans text-[11px] font-medium text-[#8b9cb2]">{unit}</small>
    </>
  );
}

export function DurationQuantity({ seconds }: { seconds: number }) {
  const { value, unit } = splitSignalDuration(seconds);
  return <Quantity value={value} unit={unit} />;
}

export function SignalPinIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="h-[17px] w-[17px]" aria-hidden="true"><path d="M14.5 3l6.5 6.5-2.2.9-3.2 3.2.4 4.9-1.4 1.4-4.2-4.2L5 21l-1-1 5.3-5.4-4.2-4.2 1.4-1.4 4.9.4 3.2-3.2z" /></svg>;
}

export function SignalPinButton({ name, pinned, onToggle }: { name: string; pinned: boolean; onToggle: () => void }) {
  return <button type="button" aria-pressed={pinned} aria-label={`${name} を${pinned ? 'ピン留めから外す' : 'ピン留めする'}`} onClick={(event) => { event.stopPropagation(); onToggle(); }} className={clsx('flex h-7 w-[30px] items-center justify-center rounded-md hover:bg-[#1f2c3c]', pinned ? 'text-[#f2c94c]' : 'text-[#3d4d62]')}><SignalPinIcon /></button>;
}

export function SignalLossBand({ loss, thresholds }: { loss: MachineSignalLoss; thresholds: MachineSignalThresholds }) {
  const slices = buildSignalLossSlices(loss, thresholds);
  return <div className="min-w-0">
    <div className="flex h-[34px] gap-0.5 overflow-hidden rounded-[5px]">
      {slices.map((slice) => <span key={slice.key} title={slice.label} className={clsx('block min-w-[2px]', slice.key === 'noRecordSeconds' && 'outline outline-1 -outline-offset-1 outline-[#243347]')} style={{ flex: `${slice.seconds} 0 0`, backgroundColor: slice.color }} />)}
    </div>
    <div className="mt-2.5 flex flex-wrap gap-x-[22px] gap-y-1.5 text-sm">
      {slices.map((slice) => <span key={slice.key}>
        <i className={clsx('mr-1.5 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]', slice.key === 'noRecordSeconds' && 'outline outline-1 outline-[#243347]')} style={{ backgroundColor: slice.color }} />
        {slice.label}<b className="ml-1.5 font-mono">{formatSignalHours(slice.seconds)}</b><small className="ml-1 text-[#8b9cb2]">時間 {Math.round(slice.ratio * 100)}%</small>
      </span>)}
    </div>
  </div>;
}
