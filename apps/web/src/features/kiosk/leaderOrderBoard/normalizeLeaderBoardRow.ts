import { resolveDisplayDueDate } from '../productionSchedule/plannedDueDisplay';

import { resolveMachineTypeCodeFromRowData } from './resolveMachineTypeCodeFromRowData';
import { buildFseibanToMachineDisplayName } from './seibanMachineNameIndex';

import type { LeaderBoardRow } from './types';
import type { ProductionScheduleRow } from '../../../api/client';

const strField = (data: Record<string, unknown>, key: string): string => {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
};

const COMPLETED_PROGRESS = '完了';

const parseProcessingOrder = (value: number | null | undefined): number | null => {
  if (value == null || Number.isNaN(value)) return null;
  return value;
};

const isRowCompleted = (data: Record<string, unknown>): boolean => {
  const p = data.progress;
  return typeof p === 'string' && p.trim() === COMPLETED_PROGRESS;
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

  const plannedQuantity =
    typeof row.plannedQuantity === 'number' && Number.isFinite(row.plannedQuantity)
      ? row.plannedQuantity
      : null;

  const noteRaw = row.note;
  const note =
    typeof noteRaw === 'string' && noteRaw.trim().length > 0 ? noteRaw.trim() : null;
  const resolvedMachineName =
    typeof row.resolvedMachineName === 'string' ? row.resolvedMachineName.trim() : '';

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
    machineName: resolvedMachineName,
    machineTypeCode: resolveMachineTypeCodeFromRowData(data),
    plannedQuantity,
    processingOrder: parseProcessingOrder(row.processingOrder),
    isCompleted: isRowCompleted(data),
    note
  };
}

export function normalizeLeaderBoardRows(rows: ProductionScheduleRow[]): LeaderBoardRow[] {
  const seibanMachine = buildFseibanToMachineDisplayName(rows);
  const out: LeaderBoardRow[] = [];
  for (const row of rows) {
    const n = normalizeLeaderBoardRow(row);
    if (n) {
      const machineName = n.machineName.trim().length > 0 ? n.machineName : (seibanMachine.get(n.fseiban) ?? '');
      out.push({ ...n, machineName });
    }
  }
  return out;
}
