import clsx from 'clsx';

import { mpKioskTheme } from '../../ui/mobilePlacementKioskTheme';

export const shelfMasterTheme = {
  /** 区画 Dialog 内の factory-map（スクロールなし・幅基準の正方形） */
  factoryMap:
    'mx-auto grid w-full max-w-[26rem] grid-cols-[auto_auto_1fr_auto_auto] grid-rows-[auto_auto_1fr_auto_auto] gap-1 aspect-square',
  dialogPanel:
    'flex max-h-[min(92dvh,800px)] min-h-0 w-full max-w-[min(96vw,920px)] flex-col !p-2',
  dialogTitle: 'text-[0.82rem] font-semibold leading-tight',
  dialogBody: 'flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto',
  dialogMapPane:
    'shrink-0 overflow-visible rounded-xl border border-slate-300 bg-slate-950 p-1.5',
  dialogDockPane:
    'min-h-0 max-h-[min(38dvh,320px)] shrink-0 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-600 bg-slate-900 p-2 [scrollbar-width:thin]',
  centerZone:
    'col-start-3 row-start-3 flex min-h-0 min-w-0 flex-col rounded-xl border-2 border-amber-400 bg-amber-950/20 p-1',
  centerZoneTitle: 'text-center text-[11px] font-bold text-amber-100',
  neighborBtn:
    'rounded-lg border border-black/10 bg-black/[0.06] px-1.5 py-1 text-[clamp(0.62rem,1.8vw,0.78rem)] font-bold text-slate-500',
  dock: 'mx-auto w-full max-w-lg space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3',
  dockShell:
    'mx-auto grid w-full max-w-[min(56rem,100%)] shrink-0 grid-cols-1 items-start gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2.5 sm:grid-cols-[1fr_minmax(14rem,1.55fr)] sm:gap-x-2.5',
  dockLeft: 'flex min-w-0 flex-col gap-1.5',
  dockRight: 'flex min-h-0 min-w-0 flex-col gap-1 border-slate-600 sm:border-l sm:pl-2.5',
  dockRightLabel: 'm-0 text-[0.62rem] font-bold text-slate-400',
  piCardsGrid:
    'grid max-h-[calc(3*2.65rem+2*0.28rem)] grid-cols-3 gap-1 overflow-x-hidden overflow-y-auto pr-0.5 [scrollbar-width:thin]',
  piCard:
    'w-full min-w-0 rounded-lg border-2 border-slate-600 bg-white/[0.04] px-1 py-0.5 text-left text-slate-100',
  piCardOn: 'border-amber-400 bg-amber-950/45 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]',
  piCardName: 'truncate text-[0.58rem] font-extrabold leading-tight',
  piCardSub: 'mt-0.5 truncate font-mono text-[0.5rem] text-sky-300',
  piSaveBtn:
    'mt-auto w-full rounded-lg border-2 border-green-700 bg-gradient-to-b from-green-800 to-green-900 px-2 py-1.5 text-[0.72rem] font-extrabold text-emerald-50',
  relocateStatus: 'text-center text-xs font-semibold text-slate-300',
  cellBase:
    'flex min-h-0 flex-col items-center justify-center gap-0.5 rounded-md border p-1 font-bold',
  cellMain: 'max-w-full overflow-hidden text-ellipsis text-[clamp(0.75rem,2.8vw,1.05rem)] leading-tight',
  cellMainUnused: 'text-[clamp(0.85rem,3vw,1.2rem)] opacity-45',
  cellBadge: 'text-[clamp(0.5rem,1.6vw,0.58rem)] font-extrabold opacity-85',
  cellCode: 'font-mono text-[clamp(0.6rem,2vw,0.75rem)] text-sky-300',
  cellMachine: 'border-slate-500 bg-slate-700 text-slate-200',
  cellShelf: 'border-amber-700 bg-amber-950 text-amber-100',
  cellAisle: 'border-dashed border-sky-600 bg-sky-950/30 text-slate-500',
  cellUnused: 'border-slate-800 bg-slate-900/50 text-slate-500',
  cellSel: 'outline outline-2 outline-sky-400',
  cellRelocateSource: 'outline outline-2 outline-emerald-400',
  cellFlowTarget: 'outline outline-2 outline-amber-400/80',
  cellDisabled: 'cursor-not-allowed opacity-35',
  ctlRow: 'flex flex-wrap items-center gap-2',
  ctlOff: 'opacity-30 cursor-not-allowed',
  ctlFlow: 'ring-2 ring-sky-400/70 ring-offset-1 ring-offset-slate-900',
  macroOverviewGrid: 'grid flex-1 min-h-0 grid-cols-3 grid-rows-3 gap-2 p-2',
  macroZoneCard:
    'flex min-h-0 flex-col rounded-xl border-2 border-white/12 bg-[color-mix(in_srgb,#6b7280_28%,#0f172a)] p-1.5',
  macroZoneCardClickable: 'cursor-pointer hover:border-sky-500/50',
  macroHead: 'mb-1 flex shrink-0 items-center gap-1.5 leading-[1.15]',
  macroName: 'shrink-0 text-[clamp(0.72rem,1.5vw,0.92rem)] font-extrabold',
  macroLegend: 'min-w-0 flex-1 text-[0.55rem] text-slate-400 whitespace-nowrap',
  macroEditBtn:
    'shrink-0 rounded-md border border-sky-500/50 bg-sky-500/10 px-1.5 py-0.5 text-[clamp(0.58rem,1.1vw,0.68rem)] font-extrabold text-sky-100',
  miniMap: 'pointer-events-none grid min-h-0 flex-1 gap-0.5',
  miniCell:
    'flex min-h-0 flex-col items-center justify-center overflow-hidden rounded border p-px text-center',
  miniCellKind: 'text-[0.42rem] font-extrabold opacity-75 leading-none',
  miniCellMain: 'max-w-full truncate text-[clamp(0.48rem,1vw,0.62rem)] font-extrabold leading-tight'
};

export function shelfMasterButtonClass(
  active: boolean,
  options?: { enabled?: boolean; flow?: boolean; variant?: 'default' | 'primary' | 'danger' }
): string {
  const enabled = options?.enabled !== false;
  const base =
    options?.variant === 'primary'
      ? mpKioskTheme.partSearchButtonActive
      : options?.variant === 'danger'
        ? 'rounded-lg border-2 border-rose-500/45 bg-rose-950/40 px-3 py-2 text-sm font-bold text-rose-100'
        : active
          ? mpKioskTheme.partSearchButtonActive
          : mpKioskTheme.partSearchButton;
  return clsx(base, !enabled && shelfMasterTheme.ctlOff, options?.flow && enabled && shelfMasterTheme.ctlFlow);
}

export function shelfMasterSelectClass(enabled: boolean, flow?: boolean): string {
  return clsx(
    'rounded-lg border border-slate-600 bg-slate-950 px-2 py-1 text-xs',
    !enabled && shelfMasterTheme.ctlOff,
    flow && enabled && shelfMasterTheme.ctlFlow
  );
}
