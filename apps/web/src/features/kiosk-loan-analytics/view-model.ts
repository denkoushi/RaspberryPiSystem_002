import type {
  ItemLoanAnalyticsResponse,
  MeasuringInstrumentLoanAnalyticsResponse,
  RiggingLoanAnalyticsResponse
} from '../../api/types';

export type DatasetTab = 'rigging' | 'items' | 'instruments';

export type AssetRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  isOutNow: boolean;
  currentBorrowerDisplayName: string | null;
  dueAt: string | null;
  periodBorrowCount: number;
  periodReturnCount: number;
  openIsOverdue: boolean;
};

export type EmployeeRow = {
  employeeId: string;
  displayName: string;
  employeeCode: string;
  openCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
};

export type PeriodEventRow = {
  kind: 'BORROW' | 'RETURN';
  eventAt: string;
  assetId: string;
  assetLabel: string;
  actorDisplayName: string | null;
  actorEmployeeId: string | null;
};

export type ViewModel = {
  periodFrom: string;
  periodTo: string;
  openLoanCount: number;
  overdueOpenCount: number;
  totalMasterCount: number;
  periodBorrowCount: number;
  periodReturnCount: number;
  assetFilterLabel: string;
  emptyAssetMessage: string;
  assets: AssetRow[];
  employees: EmployeeRow[];
  periodEvents: PeriodEventRow[];
};

function mapRigging(data: RiggingLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalRiggingGearsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetFilterLabel: '吊具',
    emptyAssetMessage: '吊具データがありません。',
    assets: data.byGear.map((row) => ({
      id: row.gearId,
      code: row.managementNumber,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openRiggingCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount
    })),
    periodEvents: data.periodEvents
  };
}

function mapItems(data: ItemLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalItemsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetFilterLabel: '表示名',
    emptyAssetMessage: '写真持出の集計データがありません。',
    assets: data.byItem.map((row) => ({
      id: row.itemId,
      code: row.itemCode || row.itemId,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openItemCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount
    })),
    periodEvents: data.periodEvents
  };
}

function mapInstruments(data: MeasuringInstrumentLoanAnalyticsResponse): ViewModel {
  return {
    periodFrom: data.meta.periodFrom,
    periodTo: data.meta.periodTo,
    openLoanCount: data.summary.openLoanCount,
    overdueOpenCount: data.summary.overdueOpenCount,
    totalMasterCount: data.summary.totalInstrumentsActive,
    periodBorrowCount: data.summary.periodBorrowCount,
    periodReturnCount: data.summary.periodReturnCount,
    assetFilterLabel: '計測機器',
    emptyAssetMessage: '計測機器の集計データがありません。',
    assets: data.byInstrument.map((row) => ({
      id: row.instrumentId,
      code: row.managementNumber,
      name: row.name,
      status: row.status,
      isOutNow: row.isOutNow,
      currentBorrowerDisplayName: row.currentBorrowerDisplayName,
      dueAt: row.dueAt,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount,
      openIsOverdue: row.openIsOverdue
    })),
    employees: data.byEmployee.map((row) => ({
      employeeId: row.employeeId,
      displayName: row.displayName,
      employeeCode: row.employeeCode,
      openCount: row.openInstrumentCount,
      periodBorrowCount: row.periodBorrowCount,
      periodReturnCount: row.periodReturnCount
    })),
    periodEvents: data.periodEvents
  };
}

export function mapResponseToViewModel(
  dataset: DatasetTab,
  payload: RiggingLoanAnalyticsResponse | ItemLoanAnalyticsResponse | MeasuringInstrumentLoanAnalyticsResponse
): ViewModel {
  if (dataset === 'rigging') {
    return mapRigging(payload as RiggingLoanAnalyticsResponse);
  }
  if (dataset === 'items') {
    return mapItems(payload as ItemLoanAnalyticsResponse);
  }
  return mapInstruments(payload as MeasuringInstrumentLoanAnalyticsResponse);
}
