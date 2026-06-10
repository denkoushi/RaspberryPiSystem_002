import clsx from 'clsx';

export const kioskHeaderNavBase = 'rounded-md px-3 py-2 text-sm font-semibold transition-colors';
export const kioskHeaderNavInactive = 'text-white hover:bg-white/10';

export function kioskHeaderNavClass(isActive: boolean, activeClassName: string): string {
  return clsx(kioskHeaderNavBase, isActive ? activeClassName : kioskHeaderNavInactive);
}
