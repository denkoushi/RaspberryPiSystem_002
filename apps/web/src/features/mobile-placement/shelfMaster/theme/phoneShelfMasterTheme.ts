export const phoneShelfTheme = {
  cell: 'relative flex min-h-0 min-w-0 flex-col items-center justify-center gap-px overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-0 font-black',
  kind: {
    SHELF: 'border-[color-mix(in_srgb,var(--hp-shelf)_50%,var(--hp-line))] text-[var(--hp-shelf)]',
    MACHINE: 'border-transparent bg-[color-mix(in_srgb,var(--hp-panel)_72%,var(--hp-teal))] text-[var(--hp-ink)]',
    AISLE: 'bg-[repeating-linear-gradient(135deg,var(--hp-panel)_0_7px,var(--hp-bg)_7px_14px)] text-[var(--hp-ink3)]',
    UNUSED: 'border-dashed bg-transparent text-[var(--hp-ink3)]',
  },
  swatch: {
    SHELF: 'bg-[var(--hp-shelf)]',
    MACHINE: 'bg-[var(--hp-teal)]',
    AISLE: 'bg-[repeating-linear-gradient(135deg,var(--hp-line)_0_2px,transparent_2px_4px)]',
    UNUSED: 'border border-dashed border-[var(--hp-ink3)]',
  },
  status: 'flex min-h-14 items-center gap-2 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3 py-2 text-sm font-black',
  dock: 'flex shrink-0 flex-col gap-2 pl-3.5 pr-[var(--hp-hermes-gutter)] pt-1.5 pb-[calc(16px+env(safe-area-inset-bottom,0px))]',
  edge: 'flex items-center justify-center gap-1 rounded-[10px] border border-[var(--hp-line)] bg-[var(--hp-panel)] text-xs font-black text-[var(--hp-ink2)]',
} as const;

export const phoneShelfKinds = [
  ['SHELF', '棚'], ['MACHINE', '加工機'], ['AISLE', '通路'], ['UNUSED', '空き'],
] as const;
