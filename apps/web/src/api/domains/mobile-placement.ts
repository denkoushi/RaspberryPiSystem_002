import { api } from '../http';

import type { ProductionScheduleListResponse } from './production-schedule';
import type { PartPlacementSearchSuggestResponse } from '../../features/mobile-placement/part-search/types';
import type { RegisteredShelfEntryDto } from '../../features/mobile-placement/registeredShelves/types';
/** 配膳スマホ: 生産スケジュール一覧（`/api/mobile-placement/schedule`、x-client-key 必須） */
/** GET /api/mobile-placement/registered-shelves（登録済み棚番候補） */
export type MobilePlacementRegisteredShelfEntry = RegisteredShelfEntryDto;

export async function getMobilePlacementRegisteredShelves() {
  const { data } = await api.get<{ shelves: RegisteredShelfEntryDto[] }>('/mobile-placement/registered-shelves');
  return data;
}

/** POST /api/mobile-placement/shelves（棚マスタへ新規登録、`西-北-01` 形式） */
export async function postMobilePlacementShelfRegister(payload: { shelfCodeRaw: string }) {
  const { data } = await api.post<{ shelf: RegisteredShelfEntryDto }>('/mobile-placement/shelves', payload);
  return data;
}

export type MobilePlacementClientCapabilities = {
  shelfLayoutEditEnabled: boolean;
  haizenEdgeEnabled: boolean;
};

export async function getMobilePlacementClientCapabilities() {
  const { data } = await api.get<MobilePlacementClientCapabilities>('/mobile-placement/client-capabilities');
  return data;
}

export type MachineMasterDto = { resourceCd: string; resourceName: string };

export async function getMobilePlacementMachineMasters() {
  const { data } = await api.get<{ machines: MachineMasterDto[] }>('/mobile-placement/machine-masters');
  return data;
}

export type ShelfLayoutSummaryDto = {
  macroZoneId: string;
  displayName: string;
  gridSize: number;
  shelfCount: number;
  machineCount: number;
  entities: ShelfLayoutEntityDto[];
};

export async function getMobilePlacementShelfLayoutSummary() {
  const { data } = await api.get<{ zones: ShelfLayoutSummaryDto[] }>('/mobile-placement/shelf-layout');
  return data;
}

export type ShelfLayoutEntityDto = {
  id: string;
  entityKind: 'MACHINE' | 'SHELF' | 'AISLE' | 'UNUSED';
  cellIndices: number[];
  resourceCd: string | null;
  resourceName: string | null;
  shelfCodeRaw: string | null;
  displayLabel: string | null;
  aisleLabel: string | null;
};

export type ShelfLayoutZoneDto = {
  macroZoneId: string;
  displayName: string;
  shelfPrefix: string;
  gridSize: 3 | 4;
  nextShelfSlot: number;
  updatedAt: string;
  entities: ShelfLayoutEntityDto[];
  zero2wDeviceCountByShelfCode: Record<string, number>;
};

export async function getMobilePlacementShelfLayoutZone(macroZoneId: string) {
  const { data } = await api.get<ShelfLayoutZoneDto>(`/mobile-placement/shelf-layout/zones/${macroZoneId}`);
  return data;
}

export async function putMobilePlacementShelfLayoutZone(
  macroZoneId: string,
  payload: {
    gridSize: 3 | 4;
    expectedUpdatedAt?: string | null;
    entities: Array<{
      entityKind: 'MACHINE' | 'SHELF' | 'AISLE' | 'UNUSED';
      cellIndices: number[];
      resourceCd?: string | null;
      resourceName?: string | null;
      aisleLabel?: string | null;
      shelfCodeRaw?: string | null;
    }>;
  }
) {
  const { data } = await api.put<ShelfLayoutZoneDto>(`/mobile-placement/shelf-layout/zones/${macroZoneId}`, payload);
  return data;
}

export async function postMobilePlacementShelfRelocate(sourceShelfCodeRaw: string, targetShelfCodeRaw: string) {
  const encoded = encodeURIComponent(sourceShelfCodeRaw);
  const { data } = await api.post<{
    sourceShelfCodeRaw: string;
    targetShelfCodeRaw: string;
    movedDisplayLabel: string | null;
  }>(`/mobile-placement/shelves/${encoded}/relocate`, { targetShelfCodeRaw });
  return data;
}

/** 部品名検索（現在棚優先・スケジュール補助）。機種名は登録製番ボタン下段と同系の MH/SH 由来。機種名のみでも可。 */
export async function getMobilePlacementPartSearchSuggest(q: string, machineName?: string) {
  const { data } = await api.get<PartPlacementSearchSuggestResponse>('/mobile-placement/part-search/suggest', {
    params: {
      q: q ?? '',
      ...(machineName != null && machineName.length > 0 ? { machineName } : {})
    }
  });
  return data;
}

export async function getMobilePlacementSchedule(params?: {
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
  targetDeviceScopeKey?: string;
}) {
  const { data } = await api.get<ProductionScheduleListResponse>('/mobile-placement/schedule', { params });
  return data;
}

export async function resolveMobilePlacementItem(barcode: string) {
  const { data } = await api.get<{
    item: { id: string; itemCode: string; name: string; storageLocation: string | null } | null;
    matchKind: 'itemCode' | 'none';
  }>('/mobile-placement/resolve-item', { params: { barcode } });
  return data;
}

export async function registerMobilePlacement(payload: {
  shelfCodeRaw: string;
  itemBarcodeRaw: string;
  csvDashboardRowId?: string;
}) {
  const { data } = await api.post<{
    event: {
      id: string;
      newStorageLocation: string;
      previousStorageLocation: string | null;
      itemId: string | null;
      shelfCodeRaw: string;
      itemBarcodeRaw: string;
    };
    item: { id: string; itemCode: string; name: string; storageLocation: string | null };
    resolveMatchKind: string;
  }>('/mobile-placement/register', payload);
  return data;
}

/** 移動票・現品票の (FSEIBAN, FHINCD) ペア照合 */
export async function verifyMobilePlacementSlipMatch(payload: {
  transferOrderBarcodeRaw: string;
  transferPartBarcodeRaw: string;
  /** 印字のみの場合は空でもよい（`actualFseibanRaw` とどちらか必須） */
  actualOrderBarcodeRaw: string;
  /** 製番。製造orderが空のときに日程解決に使う */
  actualFseibanRaw: string;
  actualPartBarcodeRaw: string;
}) {
  const { data } = await api.post<{ ok: true } | { ok: false; reason: string }>(
    '/mobile-placement/verify-slip-match',
    payload
  );
  return data;
}

/** 現品票画像を OCR し、製造order（10桁）と製番候補を返す */
export async function parseActualSlipImage(imageFile: File) {
  const form = new FormData();
  form.append('image', imageFile);
  const { data } = await api.post<{
    engine: string;
    ocrText: string;
    /** 数字・英数字 OCR のみ（プレビュー用。無い場合は `ocrText` を表示に使う） */
    ocrPreviewSafe: string | null;
    manufacturingOrder10: string | null;
    fseiban: string | null;
  }>('/mobile-placement/parse-actual-slip-image', form);
  return data;
}

/** 部品配膳（製造order番号・棚のみ。Item は更新しない） */
export async function registerOrderPlacement(payload: {
  shelfCodeRaw: string;
  manufacturingOrderBarcodeRaw: string;
}) {
  const { data } = await api.post<{
    event: {
      id: string;
      clientDeviceId: string;
      shelfCodeRaw: string;
      manufacturingOrderBarcodeRaw: string;
      csvDashboardRowId: string | null;
      branchNo: number;
      actionType: string;
      placedAt: string;
    };
    branchState: {
      id: string;
      branchNo: number;
      shelfCodeRaw: string;
    };
    resolvedRowId: string;
  }>('/mobile-placement/register-order-placement', payload);
  return data;
}

export type OrderPlacementBranchDto = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  branchNo: number;
  shelfCodeRaw: string;
  csvDashboardRowId: string | null;
  updatedAt: string;
};

/** 製造orderに紐づく分配枝の現在棚一覧 */
export async function getOrderPlacementBranches(manufacturingOrder: string) {
  const { data } = await api.get<{ branches: OrderPlacementBranchDto[] }>(
    '/mobile-placement/order-placement-branches',
    { params: { manufacturingOrder } }
  );
  return data;
}

/** 既存分配枝の棚を更新（移動） */
export async function moveOrderPlacementBranch(payload: {
  branchStateId: string;
  shelfCodeRaw: string;
}) {
  const { data } = await api.patch<{
    event: {
      id: string;
      clientDeviceId: string;
      shelfCodeRaw: string;
      manufacturingOrderBarcodeRaw: string;
      csvDashboardRowId: string | null;
      branchNo: number;
      actionType: string;
      placedAt: string;
    };
    branchState: {
      id: string;
      branchNo: number;
      shelfCodeRaw: string;
      updatedAt: string;
    };
  }>(`/mobile-placement/order-placement-branches/${payload.branchStateId}/move`, {
    shelfCodeRaw: payload.shelfCodeRaw
  });
  return data;
}

/** Zero2W 棚番エッジ: 端末の棚番プリセット */
export async function getMobilePlacementHaizenPresetShelf() {
  const { data } = await api.get<{ shelfCodeRaw: string | null }>('/mobile-placement/haizen-preset-shelf');
  return data;
}

export async function patchMobilePlacementHaizenPresetShelf(payload: { shelfCodeRaw: string }) {
  const { data } = await api.patch<{ shelfCodeRaw: string }>('/mobile-placement/haizen-preset-shelf', payload);
  return data;
}

export type HaizenTargetDeviceDto = {
  id: string;
  name: string;
  location: string | null;
  shelfCodeRaw: string | null;
  lastSeenAt: string | null;
};

/** Zero2W 担当棚設定: 候補端末一覧 */
export async function getMobilePlacementHaizenTargetDevices() {
  const { data } = await api.get<{ devices: HaizenTargetDeviceDto[] }>('/mobile-placement/haizen-target-devices');
  return data;
}

/** Zero2W 担当棚設定: 対象端末の担当棚を更新 */
export async function putMobilePlacementHaizenTargetPresetShelf(payload: {
  clientDeviceId: string;
  shelfCodeRaw: string | null;
}) {
  const { data } = await api.put<{ shelfCodeRaw: string | null }>(
    `/mobile-placement/haizen-target-devices/${payload.clientDeviceId}/preset-shelf`,
    {
      shelfCodeRaw: payload.shelfCodeRaw
    }
  );
  return data;
}

export type HaizenCurrentRowDto = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  shelfCodeRaw: string;
  clientDeviceId: string;
  distributionNumber: number | null;
  csvDashboardRowId: string | null;
  productNo: string | null;
  fseiban: string | null;
  fhincd: string | null;
  fhinmei: string | null;
  updatedAt: string;
  resolutionNote: 'RESOLVED' | 'UNRESOLVED';
};

/** Zero2W 配膳の現在値一覧（棚で絞り込み可）。`shelfCode` は後方互換、`shelfCodeRaw` を推奨 */
export async function getMobilePlacementHaizenCurrent(params?: {
  shelfCode?: string;
  shelfCodeRaw?: string;
  limit?: number;
}) {
  const shelf =
    params?.shelfCodeRaw != null && params.shelfCodeRaw.length > 0
      ? params.shelfCodeRaw
      : params?.shelfCode != null && params.shelfCode.length > 0
        ? params.shelfCode
        : undefined;
  const { data } = await api.get<{ rows: HaizenCurrentRowDto[] }>('/mobile-placement/haizen-current', {
    params: {
      ...(shelf != null ? { shelfCodeRaw: shelf } : {}),
      ...(params?.limit != null ? { limit: params.limit } : {})
    }
  });
  return data;
}
