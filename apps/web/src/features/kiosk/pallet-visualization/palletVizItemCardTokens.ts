/**
 * パレット可視化・部品カードの見た目トークン（プレビュー確定案）。
 * 密度や variant を増やす場合もここを拡張する。
 */
export const palletVizItemCardTokens = {
  root: 'touch-pan-y flex w-full flex-col gap-0 rounded-md border px-3 py-2 text-left text-[1.3125rem] transition-colors',
  selected: 'border-amber-400 bg-amber-500/20',
  unselected: 'border-white/10 bg-slate-800/80 hover:border-white/30',

  row1: 'flex w-full min-w-0 items-center gap-3',
  palletNo: 'shrink-0 font-mono text-[1.6875rem] font-bold tabular-nums text-amber-200',
  machineName: 'min-w-0 flex-1 truncate font-mono text-[1.125rem] text-white/70',
  quantity: 'shrink-0 font-mono text-[1.125rem] tabular-nums text-white/75',

  row2: 'flex min-w-0 items-center gap-3',
  fseiban: 'min-w-0 flex-1 truncate font-mono text-[1.125rem] text-white/85',
  fhincd: 'shrink-0 font-mono text-[1.125rem] text-white/60',

  /** 着手日 + 部品名（長文は line-clamp） */
  row3: 'flex min-w-0 items-start gap-3 text-[1.125rem] text-white/75',
  startDate: 'shrink-0 font-mono tabular-nums',
  partName: 'line-clamp-2 min-w-0 flex-1 text-left font-semibold leading-snug text-white/90',
} as const;
