import { COMPLETED_PROGRESS_VALUE } from '../../production-schedule/constants.js';
import { normalizeProductionScheduleResourceCd } from '../../production-schedule/policies/resource-category-policy.service.js';

/** `listProductionScheduleRows` の1行に相当（このモジュールへの入口） */
export type SignageScheduleRowInput = {
  id: string;
  rowData: unknown;
  processingOrder: number | null;
  note: string | null;
  dueDate: Date | null;
  plannedQuantity: number | null;
  plannedEndDate: Date | null;
};

export type SignageLeaderBoardRow = {
  id: string;
  resourceCd: string;
  dueDate: string | null;
  plannedEndDate: string | null;
  displayDue: string | null;
  fseiban: string;
  productNo: string;
  fkojun: string;
  fhincd: string;
  fhinmei: string;
  machineName: string;
  machineTypeCode: string;
  plannedQuantity: number | null;
  processingOrder: number | null;
  isCompleted: boolean;
};

export type SignageLeaderOrderRowPresentation = {
  machinePartLine: string;
  partNameLine: string;
  quantityInlineJa: string | null;
};

export type SignageLeaderOrderSvgRow = {
  fkojun: string;
  dueLabel: string;
  manualDue: boolean;
  machinePartLine: string;
  partNameLine: string;
  quantityInlineJa: string | null;
  isCompleted: boolean;
};

const DUE_DATE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function tryParseDueDatePartsFromIsoPrefix(value: string | null): {
  month: number;
  day: number;
  weekdayIndex: number;
} | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const weekdayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { month, day, weekdayIndex };
}

export function formatDueDateSignage(value: string | null): string {
  const parsed = tryParseDueDatePartsFromIsoPrefix(value);
  if (!parsed) return '';
  return `${parsed.month}/${parsed.day}(${DUE_DATE_WEEKDAYS[parsed.weekdayIndex]})`;
}

export function resolveDisplayDueDate(
  dueDate: string | null | undefined,
  plannedEndDate: string | null | undefined
): string | null {
  const manual = typeof dueDate === 'string' && dueDate.trim().length > 0 ? dueDate.trim() : null;
  if (manual) return manual;
  const csv =
    typeof plannedEndDate === 'string' && plannedEndDate.trim().length > 0 ? plannedEndDate.trim() : null;
  return csv;
}

export function isManualDueDateSet(dueDate: string | null | undefined): boolean {
  return typeof dueDate === 'string' && dueDate.trim().length > 0;
}

const MAX_SORT = 8640000000000000;

function displayDueDateSortKey(isoOrNull: string | null): number {
  if (isoOrNull == null || String(isoOrNull).trim().length === 0) return MAX_SORT;
  const t = new Date(isoOrNull).getTime();
  return Number.isNaN(t) ? MAX_SORT : t;
}

function compareDisplayDueDateForSort(a: string | null, b: string | null): number {
  return displayDueDateSortKey(a) - displayDueDateSortKey(b);
}

const MACHINE_TYPE_CODE_KEYS = [
  'FKISYU',
  'FKISHU',
  'FKIGIS',
  'FMODEL',
  'FMACHINE',
  'machineTypeCode',
  'KISHU',
  'FKMEI',
] as const;

function strField(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : '';
}

function resolveMachineTypeCodeFromRowData(data: Record<string, unknown>): string {
  for (const key of MACHINE_TYPE_CODE_KEYS) {
    const v = strField(data, key);
    if (v.length > 0) {
      return v;
    }
  }
  return '';
}

function toHalfWidthAscii(value: string): string {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

function normalizeMachineName(value: string | null | undefined, maxChars: number = 36): string {
  const normalized = toHalfWidthAscii(value?.trim() ?? '').toUpperCase();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function formatPlannedQuantityInlineJa(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  return `${value}個`;
}

function joinMiddleDot(parts: string[]): string {
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(' · ');
}

type ScheduleRowData = {
  FSEIBAN?: string;
  FHINCD?: string;
  FHINMEI?: string;
};

function normalizeComparisonText(value: string | null | undefined): string {
  return toHalfWidthAscii((value ?? '').trim()).toUpperCase();
}

function isMachinePartCode(fhincd: string | null | undefined): boolean {
  const normalized = normalizeComparisonText(fhincd);
  return normalized.startsWith('MH') || normalized.startsWith('SH');
}

export function buildFseibanToMachineDisplayName(rows: SignageScheduleRowInput[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
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

function parseProcessingOrder(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

function isRowCompletedFromData(data: Record<string, unknown>): boolean {
  const p = data.progress;
  return typeof p === 'string' && p.trim() === COMPLETED_PROGRESS_VALUE;
}

export function normalizeConfiguredResourceCds(rawList: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawList) {
    const n = normalizeProductionScheduleResourceCd(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function normalizeLeaderBoardRowFromScheduleRow(row: SignageScheduleRowInput): SignageLeaderBoardRow | null {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const resourceCd = strField(data, 'FSIGENCD');
  if (!resourceCd) return null;

  const dueDate =
    row.dueDate != null && String(row.dueDate).trim().length > 0 ? String(row.dueDate).trim() : null;
  const plannedEnd =
    row.plannedEndDate != null && String(row.plannedEndDate).trim().length > 0
      ? String(row.plannedEndDate).trim()
      : null;
  const displayDue = resolveDisplayDueDate(dueDate, plannedEnd);

  const plannedQuantity =
    typeof row.plannedQuantity === 'number' && Number.isFinite(row.plannedQuantity)
      ? row.plannedQuantity
      : null;

  return {
    id: row.id,
    resourceCd: normalizeProductionScheduleResourceCd(resourceCd),
    dueDate,
    plannedEndDate: plannedEnd,
    displayDue,
    fseiban: strField(data, 'FSEIBAN'),
    productNo: strField(data, 'ProductNo'),
    fkojun: strField(data, 'FKOJUN'),
    fhincd: strField(data, 'FHINCD'),
    fhinmei: strField(data, 'FHINMEI'),
    machineName: '',
    machineTypeCode: resolveMachineTypeCodeFromRowData(data),
    plannedQuantity,
    processingOrder: parseProcessingOrder(row.processingOrder),
    isCompleted: isRowCompletedFromData(data),
  };
}

export function normalizeLeaderBoardRowsForSignage(rows: SignageScheduleRowInput[]): SignageLeaderBoardRow[] {
  const seibanMachine = buildFseibanToMachineDisplayName(rows);
  const out: SignageLeaderBoardRow[] = [];
  for (const row of rows) {
    const n = normalizeLeaderBoardRowFromScheduleRow(row);
    if (n) {
      const machineName = seibanMachine.get(n.fseiban) ?? '';
      out.push({ ...n, machineName });
    }
  }
  return out;
}

function toStableNumber(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareLeaderBoardRowsByDueThenStable(left: SignageLeaderBoardRow, right: SignageLeaderBoardRow): number {
  const dueDiff = compareDisplayDueDateForSort(left.displayDue, right.displayDue);
  if (dueDiff !== 0) return dueDiff;
  const fs = left.fseiban.localeCompare(right.fseiban, 'ja');
  if (fs !== 0) return fs;
  const pn = toStableNumber(left.productNo) - toStableNumber(right.productNo);
  if (pn !== 0) return pn;
  const kj = toStableNumber(left.fkojun) - toStableNumber(right.fkojun);
  if (kj !== 0) return kj;
  return left.id.localeCompare(right.id, 'ja');
}

function compareLeaderBoardRowsForDisplay(left: SignageLeaderBoardRow, right: SignageLeaderBoardRow): number {
  const oa = left.processingOrder;
  const ob = right.processingOrder;
  const hasA = oa != null;
  const hasB = ob != null;
  if (hasA && hasB) {
    if (oa !== ob) return oa! - ob!;
    return compareLeaderBoardRowsByDueThenStable(left, right);
  }
  if (hasA !== hasB) return hasA ? -1 : 1;
  return compareLeaderBoardRowsByDueThenStable(left, right);
}

export function sortLeaderBoardRowsForDisplaySignage(rows: readonly SignageLeaderBoardRow[]): SignageLeaderBoardRow[] {
  return [...rows].sort(compareLeaderBoardRowsForDisplay);
}

export function presentLeaderOrderRowSignage(row: SignageLeaderBoardRow): SignageLeaderOrderRowPresentation {
  const machineNameNormalized = normalizeMachineName(row.machineName);
  const fseiban = String(row.fseiban ?? '').trim();
  const machinePartLine = joinMiddleDot([
    row.machineTypeCode,
    machineNameNormalized,
    fseiban.length > 0 ? fseiban : '',
    row.fhincd.length > 0 ? row.fhincd : '',
  ]);
  const partNameLine = row.fhinmei.trim();
  return {
    machinePartLine,
    partNameLine,
    quantityInlineJa: formatPlannedQuantityInlineJa(row.plannedQuantity),
  };
}

export function toLeaderOrderRowSvgModels(rows: SignageLeaderBoardRow[]): SignageLeaderOrderSvgRow[] {
  return rows.map((row) => {
    const pres = presentLeaderOrderRowSignage(row);
    const dueLabel = formatDueDateSignage(row.displayDue) || '—';
    return {
      fkojun: row.fkojun.trim() || '—',
      dueLabel,
      manualDue: isManualDueDateSet(row.dueDate),
      machinePartLine: pres.machinePartLine,
      partNameLine: pres.partNameLine,
      quantityInlineJa: pres.quantityInlineJa,
      isCompleted: row.isCompleted,
    };
  });
}
