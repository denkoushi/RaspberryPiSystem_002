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
  filterRowsBySelectedOrderNumbers,
  normalizeScheduleRows,
  type ProductionScheduleSortMode,
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
  selectedOrderNumbers: string[];
  sortMode: ProductionScheduleSortMode;
  containerWidth: number;
};

/** 生産スケジュール行の「部品測定」列（アイコン）幅 */
export const KIOSK_SCHEDULE_PART_MEASUREMENT_COL_WIDTH = 40;

type Result = {
  normalizedRows: NormalizedScheduleRow[];
  displayRows: NormalizedScheduleRow[];
  completedCount: number;
  incompleteCount: number;
  resourceCdsInRows: string[];
  manualSortEnabled: boolean;
  isDisplayRankContext: boolean;
  isTwoColumn: boolean;
  itemSeparatorWidth: number;
  checkWidth: number;
  partMeasurementColumnWidth: number;
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
  selectedOrderNumbers,
  sortMode,
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
  const machineAndPartFilteredRows = useMemo(
    () =>
      filterRowsByMachineAndPart(normalizedRows, machineToSeibanIndex, selectedMachineName, selectedPartName, {
        skipMachineFilterIfNoIndexHit: true
      }),
    [machineToSeibanIndex, normalizedRows, selectedMachineName, selectedPartName]
  );
  const filteredRows = useMemo(
    () => filterRowsBySelectedOrderNumbers(machineAndPartFilteredRows, selectedOrderNumbers),
    [machineAndPartFilteredRows, selectedOrderNumbers]
  );

  const isResourceRankFilterActive =
    normalizedResourceCds.length > 0 || normalizedAssignedOnlyCds.length > 0;
  const isSeibanScopedRankActive =
    normalizedActiveQueries.length > 0 &&
    (selectedResourceCategory !== undefined || (showGrindingResources && showCuttingResources));
  const isDisplayRankContext = isResourceRankFilterActive || isSeibanScopedRankActive;
  const resourceCdsInRows = useMemo(() => collectResourceCds(filteredRows), [filteredRows]);
  const manualSortEnabled = resourceCdsInRows.length === 1;

  const displayRows = useMemo(
    () =>
      deriveDisplayRows(filteredRows, {
        isDisplayRankContext,
        sortMode,
        manualSortEnabled
      }),
    [filteredRows, isDisplayRankContext, manualSortEnabled, sortMode]
  );

  const { completedCount, incompleteCount } = useMemo(
    () => countCompletion(filteredRows),
    [filteredRows]
  );

  const isTwoColumn = containerWidth >= 1200;
  const itemSeparatorWidth = isTwoColumn ? 24 : 0;
  const checkWidth = 36;
  const partMeasurementColumnWidth = KIOSK_SCHEDULE_PART_MEASUREMENT_COL_WIDTH;
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
      containerWidth: Math.max(0, itemWidth - checkWidth - partMeasurementColumnWidth),
      fontSizePx: 12,
      scale: 0.5,
      fixedWidths: {
        FSEIBAN: 72,
        processingType: 84,
        actualPerPieceMinutes: 95,
        plannedQuantity: 56,
        plannedStartDate: 88
      },
      formatCellValue: (_column, value) => String(value ?? ''),
      priorityGrowKeys: ['FHINMEI'],
      shrinkFirstKeys: ['FHINCD', 'FSEIBAN', 'processingType', 'plannedQuantity', 'plannedStartDate']
    });
  }, [checkWidth, itemWidth, partMeasurementColumnWidth, tableColumns, widthSampleRows]);

  const rowPairs = useMemo(() => buildRowPairs(displayRows, isTwoColumn), [displayRows, isTwoColumn]);

  return {
    normalizedRows,
    displayRows,
    completedCount,
    incompleteCount,
    resourceCdsInRows,
    manualSortEnabled,
    isDisplayRankContext,
    isTwoColumn,
    itemSeparatorWidth,
    checkWidth,
    partMeasurementColumnWidth,
    itemColumnWidths,
    rowPairs,
    machineNameOptions,
    partNameOptions
  };
};
