import { buildResourceLocalRankMap } from './displayRank';
import { toHalfWidthAscii } from './machineName';
import {
  compareDisplayDueDateForSort,
  formatPlannedDateLabel,
  formatPlannedQuantityLabel,
  resolveDisplayDueDate
} from './plannedDueDisplay';

export type ScheduleRowData = {
  ProductNo?: string;
  FSEIBAN?: string;
  FHINCD?: string;
  FHINMEI?: string;
  FSIGENCD?: string;
  FSIGENSHOYORYO?: string | number;
  FKOJUN?: string | number;
  progress?: string;
};

export type NormalizedScheduleRow = {
  id: string;
  isCompleted: boolean;
  data: ScheduleRowData;
  values: Record<string, string>;
  processingOrder: number | null;
  globalRank: number | null;
  actualPerPieceMinutes: number | null;
  processingType: string | null;
  note: string | null;
  dueDate: string | null;
  plannedQuantity: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
};

export type RawScheduleRow = {
  id: string;
  rowData?: unknown;
  processingOrder?: number | null;
  globalRank?: number | null;
  actualPerPieceMinutes?: number | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
};

export type ProductionScheduleSortMode = 'auto' | 'manual';

const normalizeComparisonText = (value: string | null | undefined): string =>
  toHalfWidthAscii((value ?? '').trim()).toUpperCase();

const isMachinePartCode = (fhincd: string | null | undefined): boolean => {
  const normalized = normalizeComparisonText(fhincd);
  return normalized.startsWith('MH') || normalized.startsWith('SH');
};

export const normalizeScheduleRows = (sourceRows: RawScheduleRow[]): NormalizedScheduleRow[] => {
  const mapped = sourceRows.map((row) => {
    const d = (row.rowData ?? {}) as ScheduleRowData;
    const processingOrder = typeof row.processingOrder === 'number' ? row.processingOrder : null;
    const globalRank = typeof row.globalRank === 'number' ? row.globalRank : null;
    const actualPerPieceMinutes =
      typeof row.actualPerPieceMinutes === 'number' ? row.actualPerPieceMinutes : null;
    const processingType =
      typeof row.processingType === 'string' && row.processingType.trim().length > 0
        ? row.processingType
        : null;
    const note = typeof row.note === 'string' && row.note.trim().length > 0 ? row.note.trim() : null;
    const dueDate =
      typeof row.dueDate === 'string' && row.dueDate.trim().length > 0 ? row.dueDate.trim() : null;
    const plannedQuantity =
      typeof row.plannedQuantity === 'number' && Number.isFinite(row.plannedQuantity)
        ? row.plannedQuantity
        : null;
    const plannedStartDate =
      typeof row.plannedStartDate === 'string' && row.plannedStartDate.trim().length > 0
        ? row.plannedStartDate.trim()
        : null;
    const plannedEndDate =
      typeof row.plannedEndDate === 'string' && row.plannedEndDate.trim().length > 0
        ? row.plannedEndDate.trim()
        : null;
    const values = {
      FHINCD: String(d.FHINCD ?? ''),
      ProductNo: String(d.ProductNo ?? ''),
      FHINMEI: String(d.FHINMEI ?? ''),
      FSIGENCD: String(d.FSIGENCD ?? ''),
      globalRank: globalRank ? String(globalRank) : '',
      actualPerPieceMinutes: actualPerPieceMinutes !== null ? actualPerPieceMinutes.toFixed(2) : '',
      processingOrder: processingOrder ? String(processingOrder) : '',
      processingType: processingType ?? '',
      FSIGENSHOYORYO: String(d.FSIGENSHOYORYO ?? ''),
      FKOJUN: String(d.FKOJUN ?? ''),
      FSEIBAN: String(d.FSEIBAN ?? ''),
      plannedQuantity: formatPlannedQuantityLabel(plannedQuantity),
      plannedStartDate: formatPlannedDateLabel(plannedStartDate)
    };
    return {
      id: row.id,
      isCompleted: d.progress === '完了',
      data: d,
      values,
      processingOrder,
      globalRank,
      actualPerPieceMinutes,
      processingType,
      note,
      dueDate,
      plannedQuantity,
      plannedStartDate,
      plannedEndDate
    };
  });

  // FHINCDがMH/SHで始まるアイテム（機種名）は検索用製番ボタンにのみ表示し、一覧からは除外
  return mapped.filter((row) => !isMachinePartCode(String(row.data.FHINCD ?? '')));
};

export const buildMachineToSeibanIndex = (sourceRows: RawScheduleRow[]): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  sourceRows.forEach((row) => {
    const rowData = (row.rowData ?? {}) as ScheduleRowData;
    const machineName = String(rowData.FHINMEI ?? '').trim();
    const fseiban = String(rowData.FSEIBAN ?? '').trim();
    if (!isMachinePartCode(String(rowData.FHINCD ?? '')) || machineName.length === 0 || fseiban.length === 0) {
      return;
    }

    const machineKey = normalizeComparisonText(machineName);
    const bucket = index.get(machineKey) ?? new Set<string>();
    bucket.add(fseiban);
    index.set(machineKey, bucket);
  });
  return index;
};

export const extractMachineNameOptions = (sourceRows: RawScheduleRow[]): string[] => {
  const machineNameMap = new Map<string, string>();
  sourceRows.forEach((row) => {
    const rowData = (row.rowData ?? {}) as ScheduleRowData;
    const machineName = String(rowData.FHINMEI ?? '').trim();
    if (!isMachinePartCode(String(rowData.FHINCD ?? '')) || machineName.length === 0) {
      return;
    }
    const key = normalizeComparisonText(machineName);
    if (!machineNameMap.has(key)) {
      machineNameMap.set(key, machineName);
    }
  });
  return Array.from(machineNameMap.values()).sort((a, b) => a.localeCompare(b, 'ja'));
};

export const filterRowsByMachineAndPart = (
  rows: NormalizedScheduleRow[],
  machineToSeibanIndex: Map<string, Set<string>>,
  selectedMachineName: string,
  selectedPartName: string,
  options?: { skipMachineFilterIfNoIndexHit?: boolean }
): NormalizedScheduleRow[] => {
  const selectedMachineKey = normalizeComparisonText(selectedMachineName);
  const selectedPartKey = normalizeComparisonText(selectedPartName);
  const selectedSeibans = selectedMachineKey.length > 0 ? machineToSeibanIndex.get(selectedMachineKey) : undefined;
  const shouldApplyMachineFilter =
    selectedMachineKey.length > 0 && !(options?.skipMachineFilterIfNoIndexHit && !selectedSeibans);

  return rows.filter((row) => {
    if (shouldApplyMachineFilter) {
      const fseiban = String(row.data.FSEIBAN ?? '').trim();
      if (!selectedSeibans || !selectedSeibans.has(fseiban)) {
        return false;
      }
    }
    if (selectedPartKey.length > 0) {
      const fhinmei = normalizeComparisonText(String(row.data.FHINMEI ?? ''));
      if (fhinmei !== selectedPartKey) {
        return false;
      }
    }
    return true;
  });
};

export const extractPartNameOptions = (rows: NormalizedScheduleRow[]): string[] => {
  const partNameMap = new Map<string, string>();
  rows.forEach((row) => {
    const partName = String(row.data.FHINMEI ?? '').trim();
    if (partName.length === 0) {
      return;
    }
    const key = normalizeComparisonText(partName);
    if (!partNameMap.has(key)) {
      partNameMap.set(key, partName);
    }
  });
  return Array.from(partNameMap.values()).sort((a, b) => a.localeCompare(b, 'ja'));
};

export const filterRowsBySelectedOrderNumbers = (
  rows: NormalizedScheduleRow[],
  selectedOrderNumbers: string[]
): NormalizedScheduleRow[] => {
  if (selectedOrderNumbers.length === 0) {
    return rows;
  }
  const selectedSet = new Set(
    selectedOrderNumbers
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
  if (selectedSet.size === 0) {
    return rows;
  }
  return rows.filter((row) => selectedSet.has(String(row.data.ProductNo ?? '').trim()));
};

export const deriveDisplayRows = (
  normalizedRows: NormalizedScheduleRow[],
  params: {
    isDisplayRankContext: boolean;
    sortMode: ProductionScheduleSortMode;
    manualSortEnabled: boolean;
  }
): NormalizedScheduleRow[] => {
  const { isDisplayRankContext, sortMode, manualSortEnabled } = params;

  if (sortMode === 'manual' && manualSortEnabled) {
    const toStableNumber = (value: string | null | undefined) => {
      const trimmed = String(value ?? '').trim();
      if (!/^\d+$/.test(trimmed)) return Number.MAX_SAFE_INTEGER;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };

    return [...normalizedRows].sort((left, right) => {
      const leftOrder = left.processingOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.processingOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const dueDiff = compareDisplayDueDateForSort(
        resolveDisplayDueDate(left.dueDate, left.plannedEndDate),
        resolveDisplayDueDate(right.dueDate, right.plannedEndDate)
      );
      if (dueDiff !== 0) return dueDiff;

      const leftFseiban = String(left.data.FSEIBAN ?? '');
      const rightFseiban = String(right.data.FSEIBAN ?? '');
      const fseibanDiff = leftFseiban.localeCompare(rightFseiban, 'ja');
      if (fseibanDiff !== 0) return fseibanDiff;

      const productNoDiff =
        toStableNumber(String(left.data.ProductNo ?? '')) - toStableNumber(String(right.data.ProductNo ?? ''));
      if (productNoDiff !== 0) return productNoDiff;

      const fkojunDiff =
        toStableNumber(String(left.data.FKOJUN ?? '')) - toStableNumber(String(right.data.FKOJUN ?? ''));
      if (fkojunDiff !== 0) return fkojunDiff;

      return left.id.localeCompare(right.id, 'ja');
    });
  }

  if (!isDisplayRankContext) {
    return normalizedRows;
  }

  const resourceLocalRankMap = buildResourceLocalRankMap(
    normalizedRows.map((row) => ({
      id: row.id,
      globalRank: row.globalRank,
      fseiban: String(row.data.FSEIBAN ?? ''),
      productNo: String(row.data.ProductNo ?? ''),
      fkojun: String(row.data.FKOJUN ?? '')
    }))
  );

  return normalizedRows
    .map((row) => {
      const resourceLocalRank = resourceLocalRankMap.get(row.id);
      if (resourceLocalRank === undefined) {
        return { row, sortKey: Number.MAX_SAFE_INTEGER };
      }
      return {
        row: {
          ...row,
          values: {
            ...row.values,
            globalRank: String(resourceLocalRank)
          }
        },
        sortKey: resourceLocalRank
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ row }) => row);
};

export const countCompletion = (rows: NormalizedScheduleRow[]) => {
  const completedCount = rows.filter((row) => row.isCompleted).length;
  return {
    completedCount,
    incompleteCount: rows.length - completedCount
  };
};

export const collectResourceCds = (rows: NormalizedScheduleRow[]): string[] => {
  const unique = new Set<string>();
  rows.forEach((row) => {
    if (row.data.FSIGENCD) {
      unique.add(row.data.FSIGENCD);
    }
  });
  return Array.from(unique);
};

export const buildRowPairs = (
  rows: NormalizedScheduleRow[],
  isTwoColumn: boolean
): Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]> => {
  if (!isTwoColumn) {
    return rows.map((row) => [row, undefined] as const);
  }

  const pairs: Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]> = [];
  for (let i = 0; i < rows.length; i += 2) {
    pairs.push([rows[i], rows[i + 1]]);
  }
  return pairs;
};
