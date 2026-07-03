import { resolveClientKey } from '../../lib/client-key';
import { api } from '../http';

// キオスク専用の従業員リスト取得（x-client-key認証）
export async function getKioskEmployees(clientKey?: string) {
  const { data } = await api.get<{ employees: Array<{ id: string; displayName: string; department: string | null }> }>('/kiosk/employees', {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.employees;
}

/** 購買照会（FKOBAINO）1行分 */
export interface PurchaseOrderLookupRowDto {
  seiban: string;
  purchasePartName: string;
  masterPartName: string;
  machineName: string;
  purchasePartCodeRaw: string;
  purchasePartCodeNormalized: string;
  acceptedQuantity: number;
  /** 生産日程補助の着手日（`YYYY-MM-DD`、無ければ null） */
  plannedStartDate: string | null;
}

export interface PurchaseOrderLookupResponse {
  purchaseOrderNo: string;
  rows: PurchaseOrderLookupRowDto[];
}

/** キオスク: 購買ナンバー（10桁）で照会 */
export async function getKioskPurchaseOrderLookup(purchaseOrderNo: string, clientKey?: string) {
  const { data } = await api.get<PurchaseOrderLookupResponse>(
    `/kiosk/purchase-order-lookup/${encodeURIComponent(purchaseOrderNo)}`,
    { headers: clientKey ? { 'x-client-key': clientKey } : undefined }
  );
  return data;
}

export interface KioskConfig {
  theme: string;
  greeting: string;
  idleTimeoutMs: number;
  defaultMode?: 'PHOTO' | 'TAG';
  navTabOrder?: string[];
  clientStatus?: {
    temperature: number | null;
    cpuUsage: number;
    lastSeen: string; // ISO date string
  } | null;
}

export type KioskNavTabOrderSettings = {
  scopeKey: string;
  tabOrder: string[];
};

export async function getKioskNavTabOrderSettings() {
  const { data } = await api.get<{ settings: KioskNavTabOrderSettings }>('/kiosk-settings/nav-tab-order');
  return data;
}

export async function updateKioskNavTabOrderSettings(payload: { tabOrder: string[] }) {
  const { data } = await api.put<{ settings: KioskNavTabOrderSettings }>(
    '/kiosk-settings/nav-tab-order',
    payload
  );
  return data;
}

export async function getKioskConfig(): Promise<KioskConfig> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.get<KioskConfig>('/kiosk/config', {
    headers: { 'x-client-key': key }
  });
  return data;
}

export type KioskSignagePreviewCandidate = {
  id: string;
  name: string;
  location: string | null;
  apiKey: string;
};

export type KioskSignagePreviewOptionsResponse = {
  candidates: KioskSignagePreviewCandidate[];
  selectedApiKey: string | null;
  effectivePreviewApiKey: string;
};

export async function getKioskSignagePreviewOptions(): Promise<KioskSignagePreviewOptionsResponse> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.get<KioskSignagePreviewOptionsResponse>('/kiosk/signage-preview/options', {
    headers: { 'x-client-key': key },
  });
  return data;
}

export async function putKioskSignagePreviewSelection(payload: {
  signagePreviewTargetApiKey: string | null;
}): Promise<{ ok: true; signagePreviewTargetApiKey: string | null }> {
  const key = resolveClientKey({ allowDefaultFallback: true }).key;
  const { data } = await api.put<{ ok: true; signagePreviewTargetApiKey: string | null }>(
    '/kiosk/signage-preview/selection',
    payload,
    { headers: { 'x-client-key': key } }
  );
  return data;
}

// キオスクサポートメッセージを送信
export async function postKioskSupport(
  payload: { message: string; page: string },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string }>('/kiosk/support', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data;
}

export async function postKioskPower(
  payload: { action: 'reboot' | 'poweroff' },
  clientKey?: string
) {
  const { data } = await api.post<{ requestId: string; action: string; status: string }>(
    '/kiosk/power',
    payload,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined
    }
  );
  return data;
}

/** パレット可視化（キオスク） */
export type PalletVisualizationItemDto = {
  id: string;
  machineCd: string;
  palletNo: number;
  displayOrder: number;
  fhincd: string;
  fhinmei: string;
  fseiban: string;
  machineName: string | null;
  machineNameDisplay: string | null;
  csvDashboardRowId: string | null;
  plannedStartDateDisplay: string | null;
  plannedQuantity: number | null;
  outsideDimensionsDisplay: string | null;
};

export type PalletVisualizationBoardResponseDto = {
  machines: Array<{
    machineCd: string;
    machineName: string;
    illustrationUrl: string | null;
    palletCount: number;
    pallets: Array<{ palletNo: number; items: PalletVisualizationItemDto[] }>;
  }>;
};

export async function getKioskPalletVisualizationBoard(clientKey?: string) {
  const { data } = await api.get<PalletVisualizationBoardResponseDto>('/kiosk/pallet-visualization/board', {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function getKioskPalletVisualizationHistory(
  params?: { limit?: number; cursor?: string },
  clientKey?: string
) {
  const { data } = await api.get<{
    events: Array<{
      id: string;
      actionType: string;
      machineCd: string;
      palletNo: number | null;
      affectedItemId: string | null;
      manufacturingOrderBarcodeRaw: string | null;
      illustrationRelativeUrl: string | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }>('/kiosk/pallet-visualization/history', {
    params,
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function postKioskPalletVisualizationItem(
  payload: { machineCd: string; palletNo: number; manufacturingOrderBarcodeRaw: string },
  clientKey?: string
) {
  const { data } = await api.post<{ id: string }>('/kiosk/pallet-visualization/items', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
  return data;
}

export async function postKioskPalletVisualizationItemReplace(
  itemId: string,
  payload: { manufacturingOrderBarcodeRaw: string },
  clientKey?: string
) {
  const { data } = await api.post<{ id: string }>(
    `/kiosk/pallet-visualization/items/${encodeURIComponent(itemId)}/replace`,
    payload,
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined,
    }
  );
  return data;
}

export async function deleteKioskPalletVisualizationItem(itemId: string, clientKey?: string) {
  await api.delete(`/kiosk/pallet-visualization/items/${encodeURIComponent(itemId)}`, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined,
  });
}

export async function clearKioskPalletVisualizationPallet(
  machineCd: string,
  palletNo: number,
  clientKey?: string
) {
  await api.post(
    `/kiosk/pallet-visualization/machines/${encodeURIComponent(machineCd)}/pallets/${palletNo}/clear`,
    {},
    {
      headers: clientKey ? { 'x-client-key': clientKey } : undefined,
    }
  );
}

export async function getToolsPalletVisualizationBoard() {
  const { data } = await api.get<PalletVisualizationBoardResponseDto>('/tools/pallet-visualization/board');
  return data;
}

export async function postToolsPalletVisualizationIllustration(machineCd: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<{ illustrationUrl: string }>(
    `/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/illustration`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

export async function deleteToolsPalletVisualizationIllustration(machineCd: string) {
  await api.delete(`/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/illustration`);
}

export async function patchToolsPalletMachinePalletCount(machineCd: string, palletCount: number) {
  await api.patch(
    `/tools/pallet-visualization/machines/${encodeURIComponent(machineCd)}/pallet-count`,
    { palletCount }
  );
}
