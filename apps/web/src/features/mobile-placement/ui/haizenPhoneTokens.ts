import type { CSSProperties } from 'react';

export const haizenPhoneColors = {
  bg: '#0d0f0e', panel: '#171a19', panel2: '#1f2321', line: '#2c312e',
  ink: '#f2f4f1', ink2: '#a3aaa5', ink3: '#6c736e',
  slip: '#38bdf8', actual: '#c4b5fd', shelf: '#fbbf24',
  teal: '#2dd4bf', lime: '#a3e635', ok: '#34d399', ng: '#f87171'
} as const;

// The 58px Hermes trigger sits 22px from the viewport edges; keep 4px clear.
export const hermesGutter = '84px';

export const haizenPhoneStyle = {
  ...Object.fromEntries(Object.entries(haizenPhoneColors).map(([key, value]) => [`--hp-${key}`, value])),
  '--hp-hermes-gutter': hermesGutter,
} as CSSProperties;

export const hp = {
  screen: 'fixed inset-0 z-40 flex h-dvh flex-col overflow-hidden bg-[var(--hp-bg)] text-[var(--hp-ink)] [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]',
  content: 'relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col',
  iconButton: 'grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] disabled:opacity-40',
  chip: 'h-9 shrink-0 whitespace-nowrap rounded-full border border-[var(--hp-line)] bg-[var(--hp-panel)] px-[13px] text-[13px] font-bold text-[var(--hp-ink2)] aria-pressed:border-[var(--hp-ink)] aria-pressed:text-[var(--hp-ink)]',
  list: 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-2.5 pt-1',
  empty: 'm-auto py-6 text-center text-[15px] font-bold text-[var(--hp-ink3)]',
  hermesBottomPadding: '!pb-[calc(var(--hp-hermes-gutter)+env(safe-area-inset-bottom,0px))]',
  dock: 'flex shrink-0 gap-2 pl-3.5 pr-[var(--hp-hermes-gutter)] pt-2.5 pb-[calc(16px+env(safe-area-inset-bottom,0px))]',
  primary: 'flex h-16 min-w-0 flex-1 items-center justify-center gap-3 rounded-[18px] px-3 text-[19px] font-black tracking-[.04em] text-[var(--hp-bg)] active:scale-[.98] disabled:opacity-40',
  bottomPrimary: 'flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 text-[18px] font-black leading-[1.15] text-[var(--hp-bg)] active:scale-[.98] disabled:opacity-40',
  surface: 'bg-[var(--hp-bg)] text-[var(--hp-ink)]',
  muted: 'text-[var(--hp-ink2)]',
  faint: 'text-[var(--hp-ink3)]',
  mini: 'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] px-2.5 text-[13px] font-bold text-[var(--hp-ink2)] disabled:opacity-40',
  input: 'h-11 min-w-0 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-bg)] px-3 font-mono text-base text-[var(--hp-ink)]',
  segment: 'h-10 shrink-0 whitespace-nowrap rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3.5 text-[15px] font-bold aria-pressed:border-[var(--hp-shelf)] aria-pressed:bg-[color-mix(in_srgb,var(--hp-panel)_70%,var(--hp-shelf))]',
  sheet: '!overflow-y-auto !fixed !bottom-0 !left-0 !right-0 !mx-auto !my-0 !max-h-[90dvh] !max-w-[480px] !rounded-b-none !rounded-t-[22px] !border-x-0 !border-b-0 !border-t !border-[#2c312e] !bg-[#171a19] !p-3.5 !pb-[calc(18px+env(safe-area-inset-bottom,0px))] !text-[#f2f4f1]'
} as const;
