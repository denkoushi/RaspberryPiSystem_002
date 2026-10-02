import clsx from 'clsx';

import { SIGNAL_HINT_CLASSES, SIGNAL_HINT_LABELS, splitSignalDuration } from './machineSignalViewModel';

import type { MachineSignalHint } from '../../api/client';
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
