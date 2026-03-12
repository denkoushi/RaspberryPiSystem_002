import { useMemo } from 'react';

import { computeColumnWidths, type TableColumnDefinition } from '../columnWidth';

import {
  buildRowPairs,
  collectResourceCds,
  countCompletion,
  deriveDisplayRows,
  normalizeScheduleRows,
  type NormalizedScheduleRow
} from './displayRowDerivation';

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

type Params = {
  rows: RawScheduleRow[] | undefined;
  tableColumns: TableColumnDefinition[];
  normalizedResourceCds: string[];
  normalizedAssignedOnlyCds: string[];
  normalizedActiveQueries: string[];
  selectedResourceCategory: 'grinding' | 'cutting' | undefined;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
  containerWidth: number;
};

type Result = {
  normalizedRows: NormalizedScheduleRow[];
  displayRows: NormalizedScheduleRow[];
  completedCount: number;
  incompleteCount: number;
  resourceCdsInRows: string[];
  isDisplayRankContext: boolean;
  isTwoColumn: boolean;
  itemSeparatorWidth: number;
  checkWidth: number;
  itemColumnWidths: number[];
  rowPairs: Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]>;
};

export const useProductionScheduleDerivedRows = ({
  rows,
  tableColumns,
  normalizedResourceCds,
  normalizedAssignedOnlyCds,
  normalizedActiveQueries,
  selectedResourceCategory,
  showGrindingResources,
  showCuttingResources,
  containerWidth
}: Params): Result => {
  const normalizedRows = useMemo(() => normalizeScheduleRows(rows ?? []), [rows]);

  const isResourceRankFilterActive =
    normalizedResourceCds.length > 0 || normalizedAssignedOnlyCds.length > 0;
  const isSeibanScopedRankActive =
    normalizedActiveQueries.length > 0 &&
    (selectedResourceCategory !== undefined || (showGrindingResources && showCuttingResources));
  const isDisplayRankContext = isResourceRankFilterActive || isSeibanScopedRankActive;

  const displayRows = useMemo(
    () => deriveDisplayRows(normalizedRows, isDisplayRankContext),
    [normalizedRows, isDisplayRankContext]
  );

  const { completedCount, incompleteCount } = useMemo(
    () => countCompletion(normalizedRows),
    [normalizedRows]
  );

  const resourceCdsInRows = useMemo(() => collectResourceCds(normalizedRows), [normalizedRows]);

  const isTwoColumn = containerWidth >= 1200;
  const itemSeparatorWidth = isTwoColumn ? 24 : 0;
  const checkWidth = 36;
  const itemWidth = isTwoColumn
    ? Math.floor((containerWidth - itemSeparatorWidth) / 2)
    : Math.floor(containerWidth);

  const widthSampleRows = useMemo(
    () => displayRows.slice(0, 80).map((row) => row.values),
    [displayRows]
  );

  const itemColumnWidths = useMemo(() => {
    return computeColumnWidths({
      columns: tableColumns,
      rows: widthSampleRows,
      containerWidth: Math.max(0, itemWidth - checkWidth),
      fontSizePx: 12,
      scale: 0.5,
      fixedWidths: {
        FSEIBAN: 90
      },
      formatCellValue: (_column, value) => String(value ?? '')
    });
  }, [checkWidth, itemWidth, tableColumns, widthSampleRows]);

  const rowPairs = useMemo(() => buildRowPairs(displayRows, isTwoColumn), [displayRows, isTwoColumn]);

  return {
    normalizedRows,
    displayRows,
    completedCount,
    incompleteCount,
    resourceCdsInRows,
    isDisplayRankContext,
    isTwoColumn,
    itemSeparatorWidth,
    checkWidth,
    itemColumnWidths,
    rowPairs
  };
};
