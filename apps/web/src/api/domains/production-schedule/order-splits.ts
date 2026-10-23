import { api } from '../../http';

import type { ProductionScheduleOrderSplitPilotSettings } from './settings';

export async function getKioskProductionScheduleOrderSplitStatus() {
  const { data } = await api.get<{
    settings: ProductionScheduleOrderSplitPilotSettings;
  }>('/kiosk/production-schedule/order-split/status');
  return data.settings;
}

export type ProductionScheduleOrderSplitItem = {
  id: string;
  displayItemId: string;
  parentCsvDashboardRowId: string;
  splitNo: number;
  splitQuantity: number;
  dueDate: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  orderNumber: number | null;
};

export type ProductionScheduleOrderSplitListResponse = {
  parentCsvDashboardRowId: string;
  plannedQuantity: number;
  splits: ProductionScheduleOrderSplitItem[];
  actorLocation?: string;
};

export async function fetchKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  params?: { targetDeviceScopeKey?: string }
) {
  const { data } = await api.get<ProductionScheduleOrderSplitListResponse>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    { params }
  );
  return data;
}

export async function replaceKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  payload: {
    resourceCd: string;
    items: Array<{
      id?: string | null;
      splitNo: number;
      splitQuantity: number;
      dueDate?: string | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      orderNumber?: number | null;
    }>;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; splits: ProductionScheduleOrderSplitItem[] }>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    payload
  );
  return data;
}

export async function deleteKioskProductionScheduleOrderSplits(
  sourceRowId: string,
  params?: { targetDeviceScopeKey?: string }
) {
  const { data } = await api.delete<{ success: boolean }>(
    `/kiosk/production-schedule/${sourceRowId}/splits`,
    { params }
  );
  return data;
}

export async function updateKioskProductionScheduleSplitOrder(
  splitId: string,
  payload: {
    resourceCd: string;
    orderNumber: number | null;
    targetLocation?: string;
    targetDeviceScopeKey?: string;
  }
) {
  const { data } = await api.put<{ success: boolean; orderNumber: number | null }>(
    `/kiosk/production-schedule/splits/${splitId}/order`,
    payload
  );
  return data;
}

export async function updateKioskProductionScheduleSplitDueDate(splitId: string, payload: { dueDate: string }) {
  const { data } = await api.put<{ success: boolean; dueDate: string | null }>(
    `/kiosk/production-schedule/splits/${splitId}/due-date`,
    payload
  );
  return data;
}
