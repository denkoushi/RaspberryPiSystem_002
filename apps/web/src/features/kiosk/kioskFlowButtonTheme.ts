import clsx from 'clsx';

import {
  kioskButtonBaseClassName,
  kioskButtonPrimaryClassName,
  kioskButtonSecondaryClassName
} from './kioskTheme';

export type KioskFlowButtonSize = 'default' | 'compact' | 'icon' | 'actionCompact' | 'entryDense';
export type KioskFlowButtonTone = 'default' | 'inactive' | 'success' | 'danger';

export type KioskFlowButtonClassOptions = {
  disabled?: boolean;
  size?: KioskFlowButtonSize;
  wide?: boolean;
  pressed?: boolean;
  highlighted?: boolean;
  tone?: KioskFlowButtonTone;
};

const sizeClass: Record<KioskFlowButtonSize, string> = {
  default: 'min-h-11 px-4 text-[15px]',
  compact: 'min-h-11 px-2 text-sm',
  icon: 'min-h-11 min-w-11 px-2 text-[1.25rem] font-semibold leading-none',
  actionCompact: 'min-h-6 px-4 py-0 text-[15px] leading-none',
  entryDense: 'h-[22px] min-h-[22px] px-2 py-0 text-base leading-none'
};

const compactPrimary =
  'rounded-md bg-emerald-500 font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40';
const compactSecondary =
  'rounded-md border border-white/20 bg-white/5 font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
const compactDisabled =
  'cursor-not-allowed rounded-md border border-white/20 bg-white/5 font-semibold text-white/40 opacity-40';
const inactive =
  clsx(kioskButtonBaseClassName, 'border border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/55');
const disabled =
  clsx(kioskButtonBaseClassName, 'cursor-not-allowed border border-white/20 bg-white/5 text-white/40 opacity-40');
const pressedDefault =
  'rounded-md border border-cyan-200 bg-cyan-400 font-semibold text-slate-950 ring-2 ring-cyan-200/60 hover:bg-cyan-300';
const success =
  'rounded-md border border-emerald-300/70 bg-emerald-950/50 font-semibold text-emerald-100 hover:bg-emerald-900/70';
const pressedSuccess =
  'rounded-md border border-emerald-200 bg-emerald-400 font-semibold text-emerald-950 ring-2 ring-emerald-200/60 hover:bg-emerald-300';
const danger =
  'rounded-md border border-red-300/70 bg-red-950/50 font-semibold text-red-100 hover:bg-red-900/70';
const pressedDanger =
  'rounded-md border border-red-200 bg-red-400 font-semibold text-red-950 ring-2 ring-red-200/60 hover:bg-red-300';

function resolveVisual(options: KioskFlowButtonClassOptions, size: KioskFlowButtonSize): string {
  const compact = size === 'actionCompact';
  if (options.disabled) return compact ? compactDisabled : disabled;
  if (options.highlighted) return compact ? compactPrimary : kioskButtonPrimaryClassName;
  if (options.pressed) {
    if (options.tone === 'success') return pressedSuccess;
    if (options.tone === 'danger') return pressedDanger;
    return pressedDefault;
  }
  if (options.tone === 'inactive') return inactive;
  if (options.tone === 'success') return success;
  if (options.tone === 'danger') return danger;
  return compact ? compactSecondary : kioskButtonSecondaryClassName;
}

export function kioskFlowButtonClass(options: KioskFlowButtonClassOptions = {}): string {
  const size = options.size ?? 'default';
  return clsx(
    'inline-flex items-center justify-center',
    sizeClass[size],
    resolveVisual(options, size),
    options.wide && 'min-w-[11rem] px-5'
  );
}
