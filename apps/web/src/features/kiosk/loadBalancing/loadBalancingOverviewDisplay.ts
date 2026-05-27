export type OverviewResourceRowInput = {
  resourceCd: string;
  requiredMinutes: number;
  availableMinutes: number | null;
  overMinutes: number;
  classCode?: string | null;
};

export type OverviewResourceBefore = {
  requiredMinutes: number;
  overMinutes: number;
};

export function isOverResource(overMinutes: number): boolean {
  return overMinutes > 0;
}

export function overviewResourceRowClassName(overMinutes: number): string {
  return isOverResource(overMinutes)
    ? 'border-b border-white/5 bg-amber-950/30'
    : 'border-b border-white/5';
}

export function overviewOverCellClassName(overMinutes: number): string {
  return isOverResource(overMinutes) ? 'px-2 py-1 font-semibold text-amber-200' : 'px-2 py-1 text-white/50';
}

export function formatReductionMinutes(
  beforeRequiredMinutes: number,
  afterRequiredMinutes: number
): { text: string; className: string } {
  const delta = Math.round(beforeRequiredMinutes - afterRequiredMinutes);
  if (delta > 0) {
    return { text: `-${delta}分`, className: 'px-2 py-1 font-semibold text-emerald-300' };
  }
  if (delta < 0) {
    return { text: `+${Math.abs(delta)}分`, className: 'px-2 py-1 font-semibold text-amber-200' };
  }
  return { text: '変化なし', className: 'px-2 py-1 text-white/50' };
}
