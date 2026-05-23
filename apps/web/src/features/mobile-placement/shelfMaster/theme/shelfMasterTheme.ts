import clsx from 'clsx';

import { mpKioskTheme } from '../../ui/mobilePlacementKioskTheme';

export const shelfMasterTheme = {
  factoryMap:
    'mx-auto grid w-full max-w-2xl grid-cols-[1fr_auto_2fr_auto_1fr] grid-rows-[1fr_auto_2fr_auto_1fr] gap-1 aspect-square max-h-[52vh]',
  centerZone:
    'col-start-3 row-start-3 flex flex-col rounded-xl border-2 border-amber-400 bg-amber-950/20 p-1',
  centerZoneTitle: 'text-center text-[11px] font-bold text-amber-100',
  neighborBtn:
    'rounded-lg border border-white/10 bg-black/40 p-1 text-[clamp(0.62rem,2vw,0.78rem)] font-bold text-slate-400',
  dock: 'mx-auto w-full max-w-lg space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3',
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
  ctlFlow: 'ring-2 ring-sky-400/70 ring-offset-1 ring-offset-slate-900'
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
