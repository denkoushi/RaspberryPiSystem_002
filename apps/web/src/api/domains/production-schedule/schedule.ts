import { api } from '../../http';

import type { SelfInspectionStatus } from '../../../features/part-measurement/types';
import type { MaterialArrivalBasis, MaterialArrivalStatus } from '@raspi-system/shared-types';

export interface ProductionScheduleRow {
  id: string;
  /** `ProductionScheduleProgressOverviewSeibanItem.seibanJoinKey` と突合する専用キー。 */
  seibanJoinKey?: string | null;
  occurredAt: string;
  /** CSV 行の最終更新日時。旧データでは null。 */
  updatedAt: string | null;
  rowData: Record<string, unknown>;
  processingOrder?: number | null;
  globalRank?: number | null;
  actualPerPieceMinutes?: number | null;
  resolvedMachineName?: string | null;
  customerName?: string | null;
  processingType?: string | null;
  note?: string | null;
  dueDate?: string | null;
  plannedQuantity?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  /** `responseProfile=leaderboard` のとき。自主検査/部品測定テンプレ突合せ用 */
  partMeasurementProcessGroup?: 'cutting' | 'grinding';
  /** `responseProfile=leaderboard` のとき。自主検査開始用テンプレ ID */
  selfInspectionTemplateId?: string | null;
  hasSelfInspectionDrawing?: boolean;
  selfInspectionStatus?: SelfInspectionStatus | null;
  selfInspectionEntryPath?: string | null;
  selfInspectionResourceCds?: string[];
  selfInspectionResourceCd?: string | null;
  /** 順位ボード: 材料の入荷状況（Web が部品キーのマップから行へ付与）。材料の購買行が無い部品は null / 省略 */
  materialArrivalStatus?: MaterialArrivalStatus | null;
  materialArrivalBasis?: MaterialArrivalBasis | null;
  /** 順位ボード: 機械行の FSIGENSHOYORYO（分）。`+人` OFF 時の表示基準。 */
  machineRequiredMinutes?: number;
  /** 順位ボード: 同一 ProductNo + FKOJUN の FSIGENCD=10 人工数（分）。 */
  laborRequiredMinutes?: number;
  /** キオスク順位ボード: 工程変更残骸疑い（通常グリッドには含めない） */
  processChangeResidualSuspected?: boolean;
  processChangeResidualEvidence?: ProcessChangeResidualEvidence;
  /** display item 契約: 親 CsvDashboardRow.id */
  sourceRowId?: string;
  splitId?: string | null;
  splitNo?: number | null;
  splitQuantity?: number | null;
  isSplit?: boolean;
}

export type ProcessChangeResidualEvidenceSide = {
  productNo: string;
  fkojun: string;
  resourceCd: string;
  status: string;
  fupdtedt: string | null;
};

export type ProcessChangeResidualEvidence = {
  current: ProcessChangeResidualEvidenceSide;
  completedOtherResource: ProcessChangeResidualEvidenceSide;
};

export interface ProductionScheduleListResponse {
  page: number;
  pageSize: number;
  /** 自主検査候補一覧など、全件数を返さない経路では省略 */
  total?: number;
  rows: ProductionScheduleRow[];
  /** `selfInspectionEligibleOnly` のとき。さらに候補がありうる */
  hasMore?: boolean;
  /**
   * `responseProfile=leaderboard` のときのみ。行下工程チップ用。
   */
  leaderboardFooterChipsByPartKey?: Record<
    string,
    Array<{
      rowId: string;
      resourceCd: string;
      resourceNames?: string[];
      isCompleted: boolean;
    }>
  >;
  /** `responseProfile=leaderboard` のときのみ。部品キー → 材料の入荷状況（材料の購買行が無い部品は含まれない）。 */
  leaderboardMaterialArrivalByPartKey?: Record<string, MaterialArrivalStatus>;
  leaderboardMaterialArrivalBasisByPartKey?: Record<string, MaterialArrivalBasis>;
  /** キオスク順位ボード: 工程変更残骸疑い（通常 rows には含めない） */
  processChangeResidualTotal?: number;
  processChangeResidualRows?: ProductionScheduleRow[];
  processChangeResidualRepresentativeLimit?: number;
}

export type ProductionScheduleCompletionFilter = 'all' | 'complete' | 'incomplete';

export async function getKioskProductionSchedule(params?: {
  productNo?: string;
  q?: string;
  productNos?: string;
  resourceCds?: string;
  resourceAssignedOnlyCds?: string;
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  hasNoteOnly?: boolean;
  hasDueDateOnly?: boolean;
  page?: number;
  pageSize?: number;
  allowResourceOnly?: boolean;
  /** v2: Mac が参照する端末の deviceScopeKey */
  targetDeviceScopeKey?: string;
  /** `leaderboard`: API が軽量プロファイルで応答（actual-hours は省略、機種名は付与） */
  responseProfile?: 'full' | 'leaderboard';
  /** 自主検査キオスク一覧: 開始可能行のみ（サーバー側フィルタ・ページング） */
  selfInspectionEligibleOnly?: boolean;
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/kiosk/production-schedule', { params });
  return data;
}

export interface KioskProductionScheduleOrderSearchResponse {
  partNameOptions: string[];
  orders: string[];
}

export type KioskProductionScheduleCompletionIntent = 'complete' | 'incomplete';

/**
 * キオスク生産日程: 完了状態を明示設定する（非トグル）。
 * 順位ボード・一覧の主経路。
 */
export async function setKioskProductionScheduleRowCompletion(
  rowId: string,
  intent: KioskProductionScheduleCompletionIntent
) {
  const { data } = await api.put<{
    success: boolean;
    unchanged?: boolean;
    alreadyCompleted: boolean;
    rowData: Record<string, unknown>;
    debug?: {
      totalMs: number;
      findRowMs: number;
      findAssignmentMs: number;
      txMs: number;
      txUpdateRowMs: number;
      txDeleteAssignmentMs: number | null;
      txShiftAssignmentsMs: number | null;
      txShiftAssignmentsCount: number | null;
      hadAssignment: boolean;
    };
  }>(`/kiosk/production-schedule/${rowId}/completion`, { intent });
  return data;
}

/** @deprecated トグル互換 API。新規は {@link setKioskProductionScheduleRowCompletion} を使用 */
export async function completeKioskProductionScheduleRow(rowId: string) {
  const { data } = await api.put<{
    success: boolean;
    alreadyCompleted: boolean;
    unchanged?: boolean;
    rowData: Record<string, unknown>;
    debug?: {
      totalMs: number;
      findRowMs: number;
      findAssignmentMs: number;
      txMs: number;
      txUpdateRowMs: number;
      txDeleteAssignmentMs: number | null;
      txShiftAssignmentsMs: number | null;
      txShiftAssignmentsCount: number | null;
      hadAssignment: boolean;
    };
  }>(`/kiosk/production-schedule/${rowId}/complete`, {});
  return data;
}

export async function getKioskProductionScheduleResources() {
  const { data } = await api.get<{
    resources: string[];
    resourceItems?: Array<{ resourceCd: string; excluded: boolean }>;
    resourceNameMap?: Record<string, string[]>;
  }>(
    '/kiosk/production-schedule/resources'
  );
  return {
    resources: data.resources,
    resourceItems: data.resourceItems ?? data.resources.map((resourceCd) => ({ resourceCd, excluded: false })),
    resourceNameMap: data.resourceNameMap ?? {}
  };
}

export async function getKioskProductionScheduleOrderUsage(params?: {
  resourceCds?: string;
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<{ usage: Record<string, number[]> }>('/kiosk/production-schedule/order-usage', {
    params
  });
  return data.usage;
}

export async function getKioskProductionScheduleOrderSearchCandidates(params: {
  resourceCds: string;
  resourceCategory?: 'grinding' | 'cutting';
  machineName?: string;
  productNoPrefix: string;
  partName?: string;
}) {
  const { data } = await api.get<KioskProductionScheduleOrderSearchResponse>(
    '/kiosk/production-schedule/order-search',
    { params }
  );
  return data;
}

export async function updateKioskProductionScheduleOrder(
  rowId: string,
  payload: {
    resourceCd: string;
    orderNumber: number | null;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; orderNumber: number | null }>(
    `/kiosk/production-schedule/${rowId}/order`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleNote(rowId: string, payload: { note: string }) {
  const { data } = await api.put<{ success: boolean; note: string | null }>(
    `/kiosk/production-schedule/${rowId}/note`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleDueDate(rowId: string, payload: { dueDate: string }) {
  const { data } = await api.put<{ success: boolean; dueDate: string | null }>(
    `/kiosk/production-schedule/${rowId}/due-date`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleProcessing(
  rowId: string,
  payload: { processingType: string }
) {
  const { data } = await api.put<{ success: boolean; processingType: string | null }>(
    `/kiosk/production-schedule/${rowId}/processing`,
    payload
  );
  return data;
}

export type ProductionScheduleSearchState = {
  inputQuery?: string;
  activeQueries?: string[];
  activeResourceCds?: string[];
  activeResourceAssignedOnlyCds?: string[];
  history?: string[];
};

export type ProductionScheduleSearchHistory = {
  history: string[];
  updatedAt: string | null;
};

export type ProductionScheduleHistoryProgressEntry = {
  total: number;
  completed: number;
  status: 'complete' | 'incomplete';
  machineName?: string | null;
};

export type ProductionScheduleHistoryProgressResponse = {
  history: string[];
  progressBySeiban: Record<string, ProductionScheduleHistoryProgressEntry>;
  updatedAt: string | null;
};

export type ProductionScheduleSearchStateResponse = {
  state: ProductionScheduleSearchState | null;
  updatedAt: string | null;
  etag: string | null;
  locationScope?: {
    deviceScopeKey: string;
    siteKey: string;
  };
};

export async function getKioskProductionScheduleSearchState(): Promise<ProductionScheduleSearchStateResponse> {
  const response = await api.get<{
    state: ProductionScheduleSearchState | null;
    updatedAt: string | null;
    locationScope?: { deviceScopeKey: string; siteKey: string };
  }>('/kiosk/production-schedule/search-state');
  const etag = (response.headers?.etag as string | undefined) ?? null;
  return { ...response.data, etag };
}

export type ProductionScheduleSearchStateUpdatePayload = {
  state: ProductionScheduleSearchState;
  ifMatch: string;
};

export type ProductionScheduleSearchStateUpdateResponse = {
  state: ProductionScheduleSearchState;
  updatedAt: string;
  etag: string | null;
};

export async function setKioskProductionScheduleSearchState(
  payload: ProductionScheduleSearchStateUpdatePayload
): Promise<ProductionScheduleSearchStateUpdateResponse> {
  const { state, ifMatch } = payload;
  const response = await api.put<{ state: ProductionScheduleSearchState; updatedAt: string }>(
    '/kiosk/production-schedule/search-state',
    { state },
    {
      headers: {
        'If-Match': ifMatch,
      },
    }
  );
  const etag = (response.headers?.etag as string | undefined) ?? null;
  return { ...response.data, etag };
}

export async function getKioskProductionScheduleSearchHistory() {
  const { data } = await api.get<ProductionScheduleSearchHistory>('/kiosk/production-schedule/search-history');
  return data;
}

export async function getKioskProductionScheduleHistoryProgress() {
  const { data } = await api.get<ProductionScheduleHistoryProgressResponse>('/kiosk/production-schedule/history-progress');
  return data;
}

export async function setKioskProductionScheduleSearchHistory(history: string[]) {
  const { data } = await api.put<{ history: string[]; updatedAt: string }>(
    '/kiosk/production-schedule/search-history',
    { history }
  );
  return data;
}

export type KioskProductionScheduleSeibanMachineNamesResponse = {
  machineNames: Record<string, string | null>;
};

export async function postKioskProductionScheduleSeibanMachineNames(payload: { fseibans: string[] }) {
  const { data } = await api.post<KioskProductionScheduleSeibanMachineNamesResponse>(
    '/kiosk/production-schedule/seiban-machine-names',
    payload
  );
  return data;
}
