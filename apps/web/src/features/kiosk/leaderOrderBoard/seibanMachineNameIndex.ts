import { toHalfWidthAscii } from '../productionSchedule/machineName';

import type { ProductionScheduleRow } from '../../../api/client';

type ScheduleRowData = {
  FSEIBAN?: string;
  FHINCD?: string;
  FHINMEI?: string;
};

const normalizeComparisonText = (value: string | null | undefined): string =>
  toHalfWidthAscii((value ?? '').trim()).toUpperCase();

const isMachinePartCode = (fhincd: string | null | undefined): boolean => {
  const normalized = normalizeComparisonText(fhincd);
  return normalized.startsWith('MH') || normalized.startsWith('SH');
};

/**
 * 生産日程一覧の raw 行から、製番 → 機種表示名（MH/SH 行の FHINMEI）の対応を構築する。
 * 部品行の機種名表示に利用する（`normalizeScheduleRows` で MH/SH 行は除外されるため、正本は raw のみ）。
 */
export function buildFseibanToMachineDisplayName(
  sourceRows: readonly ProductionScheduleRow[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of sourceRows) {
    const rowData = (row.rowData ?? {}) as ScheduleRowData;
    if (!isMachinePartCode(String(rowData.FHINCD ?? ''))) continue;
    const display = String(rowData.FHINMEI ?? '').trim();
    const fseiban = String(rowData.FSEIBAN ?? '').trim();
    if (display.length === 0 || fseiban.length === 0) continue;
    if (!index.has(fseiban)) {
      index.set(fseiban, display);
    }
  }
  return index;
}
