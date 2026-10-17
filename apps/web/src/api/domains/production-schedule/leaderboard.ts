import { api } from '../../http';

import type {
  ProductionScheduleRow,
  ProductionScheduleListResponse,
  ProductionScheduleCompletionFilter
} from './schedule';
import type { SelfInspectionStatus } from '../../../features/part-measurement/types';

export type ProductionScheduleLeaderboardShellResponse = Pick<ProductionScheduleListResponse, 'page' | 'pageSize' | 'rows'> & {
  /** shell 応答で付与。continue で送信し軽量経路となる。 */
  snapshotId?: string;
  snapshotExpired?: boolean;
  /** 次の continue で送る cursor（これまでに返した行数）。 */
  nextCursor?: number;
  hasMore?: boolean;
};

export type ProductionScheduleLeaderboardTotalResponse = { total: number };

export type ProductionScheduleLeaderboardDecorationsResponse = {
  rowDecorations: Array<{
    id: string;
    resolvedMachineName: string | null;
    customerName: string | null;
    hasSelfInspectionDrawing: boolean;
    selfInspectionTemplateId: string | null;
    selfInspectionStatus: SelfInspectionStatus | null;
    selfInspectionEntryPath: string | null;
    selfInspectionResourceCds: string[];
    selfInspectionResourceCd: string | null;
  }>;
  leaderboardFooterChipsByPartKey?: ProductionScheduleListResponse['leaderboardFooterChipsByPartKey'];
  leaderboardMaterialArrivalByPartKey?: ProductionScheduleListResponse['leaderboardMaterialArrivalByPartKey'];
  leaderboardMaterialArrivalBasisByPartKey?: ProductionScheduleListResponse['leaderboardMaterialArrivalBasisByPartKey'];
};

export type KioskProductionScheduleLeaderboardPhasedQueryParams = {
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
  completionFilter?: ProductionScheduleCompletionFilter;
  targetDeviceScopeKey?: string;
};

export async function getKioskProductionScheduleLeaderboardShell(
  params?: KioskProductionScheduleLeaderboardPhasedQueryParams
) {
  const { data } = await api.get<ProductionScheduleLeaderboardShellResponse>(
    '/kiosk/production-schedule/leaderboard-shell',
    { params }
  );
  return data;
}

export type KioskProductionScheduleLeaderboardShellContinuePayload = KioskProductionScheduleLeaderboardPhasedQueryParams & {
  /** 後方互換: snapshot が無い、または古いクライアントのみ */
  excludeRowIds?: string[];
  snapshotId?: string;
  cursor?: number;
};

export async function postKioskProductionScheduleLeaderboardShellContinue(
  payload: KioskProductionScheduleLeaderboardShellContinuePayload
) {
  const { data } = await api.post<ProductionScheduleLeaderboardShellResponse>(
    '/kiosk/production-schedule/leaderboard-shell/continue',
    payload
  );
  return data;
}

export async function getKioskProductionScheduleLeaderboardTotal(params?: KioskProductionScheduleLeaderboardPhasedQueryParams) {
  const { data } = await api.get<ProductionScheduleLeaderboardTotalResponse>(
    '/kiosk/production-schedule/leaderboard-total',
    { params }
  );
  return data;
}

export async function postKioskProductionScheduleLeaderboardDecorations(payload: {
  rowIds: string[];
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.post<ProductionScheduleLeaderboardDecorationsResponse>(
    '/kiosk/production-schedule/leaderboard-decorations',
    payload
  );
  return data;
}

export type ProductionScheduleLeaderboardLaborMetadataEntry = {
  id: string;
  machineRequiredMinutes: number;
  laborRequiredMinutes: number;
};

export type ProductionScheduleLeaderboardLaborMetadataResponse = {
  rowMetadata: ProductionScheduleLeaderboardLaborMetadataEntry[];
};

export async function postKioskProductionScheduleLeaderboardLaborMetadata(payload: {
  rowIds: string[];
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.post<ProductionScheduleLeaderboardLaborMetadataResponse>(
    '/kiosk/production-schedule/leaderboard-board/labor-metadata',
    payload
  );
  return data;
}

/** 順位ボード集約 GET: `boardResourceCds` にスロット順の資源（カンマ区切り） */
export type KioskProductionScheduleLeaderboardBoardQueryParams = KioskProductionScheduleLeaderboardPhasedQueryParams & {
  boardResourceCds: string;
  /** 省略時 true。キオスク順位ボードは false で装飾を `leaderboard-decorations` 後取り */
  includeDecorations?: boolean;
  /** 省略時 false。`+人` OFF の初期表示は false で人工数 lookup を後回しにする */
  includeLabor?: boolean;
  /** true のとき初回 shell は exact total を待たず、continue で正確な total に戻す */
  deferTotals?: boolean;
  deferResidualSummary?: boolean;
};

export type LeaderboardBoardResourceSliceResponse = {
  resourceCd: string;
  snapshotId?: string;
  nextCursor?: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
};

export type ProductionScheduleLeaderboardBoardResponse = ProductionScheduleListResponse & {
  total: number;
  totalsDeferred?: boolean;
  snapshotExpired?: boolean;
  /** 続きチャンクのみ（スロット順連結）。古いサーバまたは安全フォールバック時は未定義 */
  deltaRows?: ProductionScheduleRow[];
  resources: LeaderboardBoardResourceSliceResponse[];
  /** 工程変更残骸疑いの総件数（通常 rows には含めない） */
  processChangeResidualTotal?: number;
  processChangeResidualRows?: ProductionScheduleRow[];
  processChangeResidualRepresentativeLimit?: number;
  residualSummaryDeferred?: true;
};

export async function getKioskProductionScheduleLeaderboardBoard(
  params: KioskProductionScheduleLeaderboardBoardQueryParams
) {
  const { data } = await api.get<ProductionScheduleLeaderboardBoardResponse>(
    '/kiosk/production-schedule/leaderboard-board',
    { params }
  );
  return data;
}

export type KioskProductionScheduleLeaderboardBoardContinuePayload = Omit<
  KioskProductionScheduleLeaderboardBoardQueryParams,
  'page' | 'pageSize' | 'deferTotals'
> & {
  boardResourceCds: string;
  resourceSlices: Array<{
    resourceCd: string;
    snapshotId?: string;
    cursor?: number;
    excludeRowIds?: string[];
    hasMore: boolean;
  }>;
  pageSize?: number;
  includeResidualSummary?: boolean;
};

export async function postKioskProductionScheduleLeaderboardBoardContinue(
  payload: KioskProductionScheduleLeaderboardBoardContinuePayload
) {
  const { data } = await api.post<ProductionScheduleLeaderboardBoardResponse>(
    '/kiosk/production-schedule/leaderboard-board/continue',
    payload
  );
  return data;
}

export type KioskProductionScheduleLeaderboardClientPerfPayload = {
  sessionId: string;
  event: string;
  pagePath?: string;
  paramsKeyHash?: string;
  resourceCds?: string;
  markMs?: number;
  elapsedMs?: number;
  detail?: Record<string, string | number | boolean | null>;
};

export async function postKioskProductionScheduleLeaderboardClientPerf(
  payload: KioskProductionScheduleLeaderboardClientPerfPayload
) {
  await api.post('/kiosk/production-schedule/leaderboard-board/client-perf', payload);
}
