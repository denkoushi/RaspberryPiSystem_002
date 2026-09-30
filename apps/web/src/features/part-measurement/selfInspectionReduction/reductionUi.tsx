import clsx from 'clsx';

import { REDUCTION_VERDICT_LABELS } from './selfInspectionReductionViewModel';

import type { SelfInspectionReductionVerdict } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';


export const kioskButtonClass =
  'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-[#2f4159] bg-[#141e2b] px-4 text-base font-bold text-[#e8eef6] transition-colors hover:border-[#46607f] disabled:opacity-50';

export const kioskPrimaryButtonClass =
  'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-sky-300 bg-sky-300 px-4 text-base font-bold text-[#06243a] transition hover:brightness-110 disabled:opacity-50';

export const kioskInputClass =
  'h-11 rounded-lg border border-[#2f4159] bg-[#0a111a] px-3 text-base text-[#e8eef6] placeholder:text-[#5b6b80]';

const PILL_CLASSES: Record<SelfInspectionReductionVerdict, string> = {
  reduce: 'bg-[#0f3a2e] text-[#7ff0c5] ring-[#1f6b53]',
  almost: 'bg-[#132c4f] text-[#a8cbff] ring-[#2a4f86]',
  keep: 'bg-[#1e2836] text-[#c3cfdd] ring-[#34465e]',
  restore: 'bg-[#3d1622] text-[#ffb3c0] ring-[#7a2a3c]',
  unjudgeable: 'border border-dashed border-[#46607f] bg-transparent text-[#94a3b8] ring-transparent'
};

export function VerdictPill({
  verdict,
  size = 'md',
  suffix
}: {
  verdict: SelfInspectionReductionVerdict;
  size?: 'md' | 'lg';
  suffix?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold ring-1 ring-inset',
        size === 'lg' ? 'h-10 px-4 text-[17px]' : 'h-8 px-3 text-[15px]',
        PILL_CLASSES[verdict]
      )}
    >
      {REDUCTION_VERDICT_LABELS[verdict]}
      {suffix ? <span aria-hidden="true">{suffix}</span> : null}
    </span>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  prefix
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  prefix?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-11 items-stretch rounded-[9px] border border-[#243347] bg-[#0a111a] p-[3px]">
      {prefix ? <span className="self-center pl-2.5 pr-2 text-[13px] text-[#72849b]">{prefix}</span> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={clsx(
              'rounded-md px-3.5 text-[15px] font-bold transition-colors',
              selected ? 'bg-[#1f2f45] text-[#e8eef6] ring-1 ring-inset ring-[#3a5476]' : 'text-[#72849b] hover:text-[#aab8ca]'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function NfcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 8.5a8 8 0 0 1 0 7M9.5 6.5a12 12 0 0 1 0 11M13 4.5a16 16 0 0 1 0 15" />
    </svg>
  );
}

/** 社員タグの読み取りを待っている間の案内。記号と短い言葉だけにする。 */
export function NfcPrompt({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[10px] border border-[#1f5a86] bg-[#0c2438] py-2.5 pl-4 pr-3 text-[17px] font-bold" role="status">
      <NfcIcon className="h-[30px] w-[30px] animate-pulse text-sky-300 motion-reduce:animate-none" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
