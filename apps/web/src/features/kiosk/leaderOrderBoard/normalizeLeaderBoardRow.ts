import { resolveDisplayDueDate } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';
import type { ProductionScheduleRow } from '../../../api/client';

const strField = (data: Record<string, unknown>, key: string): string => {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
};

const parseProcessingOrder = (value: number | null | undefined): number | null => {
  if (value == null || Number.isNaN(value)) return null;
  return value;
};

/**
 * 生産日程一覧 API 行をリーダーボード用に正規化する。
 */
export function normalizeLeaderBoardRow(row: ProductionScheduleRow): LeaderBoardRow | null {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const resourceCd = strField(data, 'FSIGENCD');
  if (!resourceCd) return null;

  const dueDate = row.dueDate != null && String(row.dueDate).trim().length > 0 ? String(row.dueDate).trim() : null;
  const plannedEnd =
    row.plannedEndDate != null && String(row.plannedEndDate).trim().length > 0
      ? String(row.plannedEndDate).trim()
      : null;
  const displayDue = resolveDisplayDueDate(dueDate, plannedEnd);

  return {
    id: row.id,
    resourceCd,
    dueDate,
    plannedEndDate: plannedEnd,
    displayDue,
    fseiban: strField(data, 'FSEIBAN'),
    productNo: strField(data, 'ProductNo'),
    fkojun: strField(data, 'FKOJUN'),
    fhincd: strField(data, 'FHINCD'),
    fhinmei: strField(data, 'FHINMEI'),
    processingOrder: parseProcessingOrder(row.processingOrder)
  };
}

export function normalizeLeaderBoardRows(rows: ProductionScheduleRow[]): LeaderBoardRow[] {
  const out: LeaderBoardRow[] = [];
  for (const row of rows) {
    const n = normalizeLeaderBoardRow(row);
    if (n) out.push(n);
  }
  return out;
}
