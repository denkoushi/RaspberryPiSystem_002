import { normalizeMachineName } from '../productionSchedule/machineName';

/** 分 → 時間（小数1桁、.0 は省く）。現場の生産システムと同じ H 表示に揃える */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function formatMonthLabel(bucket: string): string {
  if (bucket === 'late') return '遅れ';
  return `${Number(bucket.slice(5, 7))}月`;
}

export function formatYearMonthSlash(bucket: string): string {
  return bucket === 'late' ? '遅れ' : bucket.replace('-', '/');
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 負荷率の段階（色分け用） */
export type LoadLevel = 'empty' | 'normal' | 'near' | 'over' | 'hot';

export function resolveLoadLevel(loadMinutes: number, capacityMinutes: number): LoadLevel {
  if (loadMinutes < 30) return 'empty';
  const ratio = capacityMinutes > 0 ? loadMinutes / capacityMinutes : Number.POSITIVE_INFINITY;
  if (ratio <= 0.85) return 'normal';
  if (ratio <= 1) return 'near';
  if (ratio <= 1.15) return 'over';
  return 'hot';
}

/** 機種名を他のキオスク画面と同じく半角・大文字にそろえる（絞り込みのキーにも使うので省略しない） */
export function formatLoadBalancingMachineName(value: string): string {
  return normalizeMachineName(value, { maxChars: Number.MAX_SAFE_INTEGER });
}
