import { buildResourceLocalRankMap } from './displayRank';

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
};

type RawScheduleRow = {
  id: string;
  rowData?: unknown;
  processingOrder?: number | null;
  globalRank?: number | null;
  actualPerPieceMinutes?: number | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
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
      FSEIBAN: String(d.FSEIBAN ?? '')
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
      dueDate
    };
  });

  // FHINCDがMH/SHで始まるアイテム（機種名）は検索用製番ボタンにのみ表示し、一覧からは除外
  return mapped.filter((row) => {
    const fhincd = String(row.data.FHINCD ?? '').toUpperCase();
    return !fhincd.startsWith('MH') && !fhincd.startsWith('SH');
  });
};

export const deriveDisplayRows = (
  normalizedRows: NormalizedScheduleRow[],
  isDisplayRankContext: boolean
): NormalizedScheduleRow[] => {
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
