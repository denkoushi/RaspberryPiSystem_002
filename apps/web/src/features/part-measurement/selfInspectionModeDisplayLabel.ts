import type { SelfInspectionMode } from './types';

/** Operator-facing label for an already normalized self-inspection mode. */
export function selfInspectionModeDisplayLabel(mode: SelfInspectionMode, fixedCount: number | null): string {
  switch (mode) {
    case 'single':
      return '抜き取り1個';
    case 'first_last':
      return '最初と最後';
    case 'fixed_count':
      return `指定数 ${fixedCount ?? '—'} 件`;
    case 'full':
    default:
      return '全数';
  }
}
