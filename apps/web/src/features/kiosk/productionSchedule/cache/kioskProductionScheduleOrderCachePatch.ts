import type { KioskProductionScheduleListCache } from './kioskProductionScheduleListCache';

export function patchScheduleListProcessingOrder(
  data: KioskProductionScheduleListCache,
  rowId: string,
  orderNumber: number | null
): KioskProductionScheduleListCache {
  return {
    ...data,
    rows: data.rows.map((row) =>
      row.id === rowId ? { ...row, processingOrder: orderNumber } : row
    )
  };
}

/**
 * 資源内で1行の加工順が prev → next に変わったときの order-usage（占有番号の配列）を更新する。
 */
export function patchOrderUsageForProcessingOrderChange(
  usage: Record<string, number[]>,
  resourceCd: string,
  previousOrder: number | null,
  nextOrder: number | null
): Record<string, number[]> {
  const cd = resourceCd.trim();
  if (cd.length === 0) {
    return { ...usage };
  }
  const current = usage[cd] ?? [];
  const set = new Set(current);
  if (previousOrder != null) {
    set.delete(previousOrder);
  }
  if (nextOrder != null) {
    set.add(nextOrder);
  }
  const nextArr = Array.from(set).sort((a, b) => a - b);
  return { ...usage, [cd]: nextArr };
}

export function findProcessingOrderForRow(
  rows: Array<{ id: string; processingOrder?: number | null }>,
  rowId: string
): number | null {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return null;
  return row.processingOrder ?? null;
}
