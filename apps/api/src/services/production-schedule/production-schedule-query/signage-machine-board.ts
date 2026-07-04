import { prepareProductionScheduleDashboardFilters } from './filters.js';
import { fetchProductionScheduleDashboardRowsRawPage } from './raw-page.js';
import type { ProductionScheduleRow } from './types.js';

export type SignageMachineBoardScheduleRow = Pick<
  ProductionScheduleRow,
  'id' | 'rowData' | 'dueDate' | 'plannedQuantity'
>;

export type SignageMachineBoardScheduleFetchResult = {
  rows: SignageMachineBoardScheduleRow[];
  /** 機種に紐づく生産日程行を最後まで走査した */
  scheduleExhausted: boolean;
  /** 安全上限により走査を打ち切った */
  hitScanCap: boolean;
  /** ボード表示件数上限（UI メタデータ。取得打ち切りには使わない） */
  maxRows: number;
};

/** 1 リクエストあたりの機種別生産日程スキャン上限（pageSize × この値） */
export const SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES = 50;

export type SignageMachineBoardScheduleScanMeta = {
  /** 機種に紐づく生産日程行を最後まで走査した */
  scheduleExhausted: boolean;
  /** 安全上限により走査を打ち切った */
  hitScanCap: boolean;
  /** ボード表示件数上限（UI メタデータ） */
  maxRows: number;
};

function mapSignageMachineBoardScheduleRows(
  rows: ProductionScheduleRow[]
): SignageMachineBoardScheduleRow[] {
  return rows.map((row) => ({
    id: row.id,
    rowData: row.rowData,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
  }));
}

/** サイネージ自主検査ボード向け: 生産日程行をページ単位で走査（全件メモリ保持しない） */
export async function scanProductionScheduleRowsForSignageMachineBoard(
  params: {
    machineName: string;
    locationKey: string;
    siteKey?: string;
    maxRows: number;
    pageSize?: number;
    /** テスト用。省略時は SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES */
    maxScanPages?: number;
  },
  onPage: (rows: SignageMachineBoardScheduleRow[]) => Promise<void> | void
): Promise<SignageMachineBoardScheduleScanMeta> {
  const displayCap = Math.max(1, Math.min(Math.floor(params.maxRows), 2000));
  const safePageSize = Math.max(1, Math.min(Math.floor(params.pageSize ?? 500), 2000));
  const maxScanPages = Math.max(
    1,
    Math.floor(params.maxScanPages ?? SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES)
  );
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    machineName: params.machineName,
    resourceCds: [],
    assignedOnlyCds: [],
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.locationKey,
    siteKey: params.siteKey,
  });
  if (filters.kind === 'blocked_empty_search') {
    return {
      scheduleExhausted: true,
      hitScanCap: false,
      maxRows: displayCap,
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  let offset = 0;
  let scanIterations = 0;
  let scheduleExhausted = false;
  let hitScanCap = false;

  while (scanIterations < maxScanPages) {
    scanIterations += 1;
    const pageRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit: safePageSize,
    });
    if (pageRows.length > 0) {
      await onPage(mapSignageMachineBoardScheduleRows(pageRows));
    }
    if (pageRows.length < safePageSize) {
      scheduleExhausted = true;
      break;
    }
    offset += pageRows.length;
  }

  if (!scheduleExhausted && scanIterations >= maxScanPages) {
    hitScanCap = true;
  }

  return {
    scheduleExhausted,
    hitScanCap,
    maxRows: displayCap,
  };
}

/** サイネージ自主検査ボード向け: total count / 実績時間 / 機種名・顧客名補完を省略した軽量一覧 */
export async function listProductionScheduleRowsForSignageMachineBoard(params: {
  machineName: string;
  locationKey: string;
  siteKey?: string;
  maxRows: number;
  pageSize?: number;
  /** テスト用。省略時は SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES */
  maxScanPages?: number;
}): Promise<SignageMachineBoardScheduleFetchResult> {
  const rows: SignageMachineBoardScheduleRow[] = [];
  const meta = await scanProductionScheduleRowsForSignageMachineBoard(params, (pageRows) => {
    rows.push(...pageRows);
  });

  return {
    rows,
    ...meta,
  };
}
