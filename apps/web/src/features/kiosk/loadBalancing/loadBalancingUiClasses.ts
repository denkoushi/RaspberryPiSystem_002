/**
 * 負荷調整画面の見た目契約（Tailwind クラス集合）。
 * 参照: docs/previews/kiosk-load-balancing-layout-preview.html
 */

export const lbPage = {
  /** 他キオスク同様に画面幅いっぱい（max-width キャップなし） */
  root: 'flex h-full min-h-0 w-full min-w-0 flex-col gap-2.5 overflow-auto px-2 py-2 text-sm leading-snug text-white',
  stack: 'flex min-w-0 flex-col gap-2.5'
} as const;

export const lbCard = {
  base: 'rounded-[10px] border border-white/15 bg-slate-900/70 p-3 text-white',
  header: 'rounded-[10px] border border-white/15 bg-slate-900/70 p-3 text-white',
  emerald: 'h-full rounded-[10px] border border-emerald-500/35 bg-emerald-950/25 p-3 text-white',
  amber: 'rounded-[10px] border border-amber-500/30 bg-amber-950/20 p-3 text-white',
  inset: 'rounded-lg border border-white/15 bg-slate-950/50 p-2'
} as const;

export const lbGrid = {
  topRow: 'grid gap-3 md:grid-cols-[minmax(11rem,12rem)_minmax(0,1fr)]',
  /** 左: 棒グラフ＋試算表（広め） / 右: 推奨セット（3番・現状維持） */
  workspaceRow:
    'grid min-w-0 items-start gap-2.5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]',
  leftStack: 'flex min-w-0 flex-col gap-2.5'
} as const;

export const lbText = {
  pageTitle: 'mr-auto text-xl font-bold text-white',
  section: 'text-[0.9375rem] font-semibold text-white',
  body: 'text-sm text-white/90',
  muted: 'text-sm text-white/65',
  meta: 'text-xs text-white/60',
  error: 'text-sm text-rose-100',
  success: 'font-semibold text-emerald-300',
  warning: 'font-semibold text-amber-200'
} as const;

export const lbStep = {
  root: 'mb-2 inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-white',
  badge:
    'inline-grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-sky-600 text-xs font-black leading-none text-white'
} as const;

export const lbInput = {
  month:
    'w-full rounded-lg border border-white/25 bg-slate-950 px-2.5 py-2 text-[0.9375rem] text-white'
} as const;

export const lbTable = {
  /** キオスク実機でもプレビュー(body 14px)に揃える — 0.8125rem は Pi 上で小さく見えやすい */
  root: 'w-full border-collapse text-left text-sm leading-snug text-white/90',
  compact: 'w-full table-fixed border-collapse text-left text-sm leading-snug text-white/90',
  headCell: 'px-2 py-1.5 text-sm font-semibold',
  bodyCell: 'px-2 py-1.5 text-sm',
  valueCell: 'px-2 py-1.5 text-sm tabular-nums',
  cellMono: 'px-2 py-1.5 font-mono text-sm',
  headRow: 'border-b border-white/10',
  bodyRow: 'border-b border-white/5',
  interactiveRow: 'min-h-10 cursor-pointer border-b border-white/5',
  interactiveRowActive: 'bg-fuchsia-900/40',
  stickyHead: 'sticky top-0 z-[1] bg-slate-900',
  scrollBox: 'max-h-56 overflow-auto',
  scrollBoxMd: 'max-h-64 overflow-auto',
  scrollBoxLg: 'max-h-72 overflow-auto'
} as const;

export const lbForm = {
  label: 'flex flex-col gap-1 text-sm font-semibold text-white/90',
  field:
    'h-10 min-h-10 w-full rounded-lg border border-white/25 bg-slate-950 px-2.5 text-sm text-white',
  fieldMono:
    'h-10 min-h-10 w-full rounded-lg border border-white/25 bg-slate-950 px-2.5 font-mono text-sm uppercase text-white',
  row: 'flex flex-wrap items-end gap-2.5',
  fieldGroup: 'flex min-w-[12rem] flex-col gap-1',
  fieldGroupSm: 'flex min-w-[10rem] flex-col gap-1',
  fieldGroupLg: 'flex min-w-[14rem] flex-col gap-1'
} as const;

export const lbNote = {
  disclaimer: 'text-xs text-white/55',
  loadingHint: 'text-xs text-white/60'
} as const;

export const lbLoading = {
  banner: 'rounded-lg border border-white/10 bg-slate-950/40 p-3',
  skeletonBar: 'h-4 rounded bg-white/10',
  skeletonRow: 'flex gap-2',
  status: 'text-sm text-white/70'
} as const;

export const lbError = {
  banner: 'rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-100'
} as const;

/** 試算結果表（4番）— 棒グラフ列幅に収め、数値列は右寄せ・狭幅 */
export const lbResultsTableCol = {
  resourceCd: 'w-[12%]',
  num: 'w-[11%] text-right',
  classCode: 'min-w-0 truncate'
} as const;

export const lbBtn = {
  base: 'rounded-lg font-semibold text-white disabled:opacity-40',
  tabActive: 'rounded-lg bg-fuchsia-600 px-3.5 py-2 text-sm font-semibold text-white',
  tabIdle: 'rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white/85',
  tabV: 'grid h-9 w-9 place-items-center rounded-lg bg-slate-700 text-sm font-black text-white',
  sky: 'rounded-lg bg-sky-600 px-3.5 py-2 text-sm',
  slate: 'rounded-lg bg-slate-600 px-3.5 py-2 text-sm',
  slateSm: 'rounded-lg bg-slate-600 px-2.5 py-1.5 text-[0.8125rem]',
  green: 'rounded-lg bg-emerald-600 px-3.5 py-2 text-sm',
  greenLg: 'rounded-lg bg-emerald-600 px-4 py-2.5 text-sm',
  amber: 'rounded-lg bg-amber-600 px-3.5 py-2 text-sm',
  roseSm: 'rounded-md bg-rose-800 px-2.5 py-1.5 text-[0.8125rem] font-semibold text-white',
  greenSm: 'rounded-md bg-emerald-800 px-2.5 py-1.5 text-[0.8125rem] font-semibold text-white'
} as const;

export const lbChip = {
  grid: 'flex max-h-[min(180px,28dvh)] min-h-[2.75rem] flex-wrap gap-2 overflow-auto',
  over:
    'flex min-w-[5.5rem] max-w-[9rem] flex-col items-start gap-0.5 rounded-lg bg-amber-700 px-3 py-2 text-left text-white',
  idle:
    'flex min-w-[5.5rem] max-w-[9rem] flex-col items-start gap-0.5 rounded-lg bg-slate-700 px-3 py-2 text-left text-white/85',
  line1: 'w-full truncate font-mono text-sm font-semibold leading-tight',
  line2: 'w-full truncate text-xs font-medium leading-tight opacity-90'
} as const;

export const lbChart = {
  legend: 'mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85',
  legendSwatch: 'inline-block h-3 w-3 shrink-0 rounded-sm',
  /** 俯瞰棒グラフ — ビューポート内で横スクロール */
  scroll: 'w-full min-w-0 overflow-x-auto overscroll-x-contain',
  container: 'h-[min(260px,34dvh)] w-full min-w-0'
} as const;

export function lbTabClassName(active: boolean): string {
  return active ? lbBtn.tabActive : lbBtn.tabIdle;
}

export function lbChipClassName(selected: boolean): string {
  return selected ? lbChip.over : lbChip.idle;
}
