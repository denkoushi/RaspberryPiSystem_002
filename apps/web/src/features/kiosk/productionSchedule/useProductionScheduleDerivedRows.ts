import { useMemo } from 'react';

import { computeColumnWidths, type TableColumnDefinition } from '../columnWidth';

import {
  buildMachineToSeibanIndex,
  buildRowPairs,
  collectResourceCds,
  countCompletion,
  deriveDisplayRows,
  extractMachineNameOptions,
  extractPartNameOptions,
  filterRowsByMachineAndPart,
  normalizeScheduleRows,
  type NormalizedScheduleRow,
  type RawScheduleRow
} from './displayRowDerivation';

const EMPTY_ROWS: RawScheduleRow[] = [];

type Params = {
  rows: RawScheduleRow[] | undefined;
  tableColumns: TableColumnDefinition[];
  normalizedResourceCds: string[];
  normalizedAssignedOnlyCds: string[];
  normalizedActiveQueries: string[];
  selectedResourceCategory: 'grinding' | 'cutting' | undefined;
  showGrindingResources: boolean;
  showCuttingResources: boolean;
  selectedMachineName: string;
  selectedPartName: string;
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
  machineNameOptions: string[];
  partNameOptions: string[];
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
  selectedMachineName,
  selectedPartName,
  containerWidth
}: Params): Result => {
  const sourceRows = rows ?? EMPTY_ROWS;
  const normalizedRows = useMemo(() => normalizeScheduleRows(sourceRows), [sourceRows]);
  const machineToSeibanIndex = useMemo(() => buildMachineToSeibanIndex(sourceRows), [sourceRows]);
  const machineNameOptions = useMemo(() => extractMachineNameOptions(sourceRows), [sourceRows]);
  const machineFilteredRows = useMemo(
    () =>
      filterRowsByMachineAndPart(normalizedRows, machineToSeibanIndex, selectedMachineName, '', {
        // API側ですでに machineName 絞り込み済みの場合、MH/SH行が無く index が空でも
        // 部品候補・一覧を落とさないようにする。
        skipMachineFilterIfNoIndexHit: true
      }),
    [machineToSeibanIndex, normalizedRows, selectedMachineName]
  );
  const partNameOptions = useMemo(() => extractPartNameOptions(machineFilteredRows), [machineFilteredRows]);
  const filteredRows = useMemo(
    () =>
      filterRowsByMachineAndPart(normalizedRows, machineToSeibanIndex, selectedMachineName, selectedPartName, {
        skipMachineFilterIfNoIndexHit: true
      }),
    [machineToSeibanIndex, normalizedRows, selectedMachineName, selectedPartName]
  );

  const isResourceRankFilterActive =
    normalizedResourceCds.length > 0 || normalizedAssignedOnlyCds.length > 0;
  const isSeibanScopedRankActive =
    normalizedActiveQueries.length > 0 &&
    (selectedResourceCategory !== undefined || (showGrindingResources && showCuttingResources));
  const isDisplayRankContext = isResourceRankFilterActive || isSeibanScopedRankActive;

  const displayRows = useMemo(
    () => deriveDisplayRows(filteredRows, isDisplayRankContext),
    [filteredRows, isDisplayRankContext]
  );

  const { completedCount, incompleteCount } = useMemo(
    () => countCompletion(filteredRows),
    [filteredRows]
  );

  const resourceCdsInRows = useMemo(() => collectResourceCds(filteredRows), [filteredRows]);

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
        FSEIBAN: 90,
        actualPerPieceMinutes: 95
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
    rowPairs,
    machineNameOptions,
    partNameOptions
  };
};
