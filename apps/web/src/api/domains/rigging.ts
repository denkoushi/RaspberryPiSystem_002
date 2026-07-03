import { api } from '../http';

import type {
  Loan,
  RiggingBorrowPayload,
  RiggingGear,
  RiggingGearTag,
  RiggingInspectionRecord,
  RiggingInspectionResult,
  RiggingLoanAnalyticsResponse,
  RiggingReturnPayload,
  RiggingStatus,
  ItemLoanAnalyticsResponse,
  MeasuringInstrumentLoanAnalyticsResponse,
} from '../types';
// 吊具 API
export async function getRiggingLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  riggingGearId?: string;
}) {
  const { data } = await api.get<RiggingLoanAnalyticsResponse>('/rigging-gears/loan-analytics', { params });
  return data;
}

/** タグアイテム（itemId）の持出・返却集計。吊具・計測機器ローンは含まない */
export async function getItemLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  itemId?: string;
}) {
  const { data } = await api.get<ItemLoanAnalyticsResponse>('/tools/items/loan-analytics', { params });
  return data;
}

export async function getMeasuringInstrumentLoanAnalytics(params?: {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  measuringInstrumentId?: string;
}) {
  const { data } = await api.get<MeasuringInstrumentLoanAnalyticsResponse>('/measuring-instruments/loan-analytics', {
    params,
  });
  return data;
}

export async function getRiggingGears(params?: { search?: string; status?: RiggingStatus }) {
  const { data } = await api.get<{ riggingGears: RiggingGear[] }>('/rigging-gears', { params });
  return data.riggingGears;
}

export async function getRiggingGear(id: string) {
  const { data } = await api.get<{ riggingGear: RiggingGear }>(`/rigging-gears/${id}`);
  return data.riggingGear;
}

export async function getRiggingGearByTagUid(tagUid: string) {
  const { data } = await api.get<{ riggingGear: RiggingGear }>(`/rigging-gears/by-tag/${encodeURIComponent(tagUid)}`);
  return data.riggingGear;
}

export async function createRiggingGear(payload: Partial<RiggingGear> & { name: string; managementNumber: string }) {
  const { data } = await api.post<{ riggingGear: RiggingGear }>('/rigging-gears', payload);
  return data.riggingGear;
}

export async function updateRiggingGear(id: string, payload: Partial<RiggingGear>) {
  const { data } = await api.put<{ riggingGear: RiggingGear }>(`/rigging-gears/${encodeURIComponent(id)}`, payload);
  return data.riggingGear;
}

export async function deleteRiggingGear(id: string) {
  const { data } = await api.delete<{ riggingGear: RiggingGear }>(`/rigging-gears/${encodeURIComponent(id)}`);
  return data.riggingGear;
}

export async function setRiggingGearTag(riggingGearId: string, rfidTagUid: string) {
  const { data } = await api.post<{ tag: RiggingGearTag }>(`/rigging-gears/${encodeURIComponent(riggingGearId)}/tags`, {
    rfidTagUid
  });
  return data.tag;
}

export async function deleteRiggingGearTag(tagId: string) {
  const { data } = await api.delete<{ tag: RiggingGearTag }>(`/rigging-gear-tags/${encodeURIComponent(tagId)}`);
  return data.tag;
}

export async function getRiggingInspectionRecords(riggingGearId: string) {
  try {
    const { data } = await api.get<{ inspectionRecords: RiggingInspectionRecord[] }>(
      `/rigging-gears/${riggingGearId}/inspection-records`
    );
    return data.inspectionRecords;
  } catch {
    throw new Error('点検記録の取得に失敗しました');
  }
}

export async function createRiggingInspectionRecord(payload: {
  riggingGearId: string;
  loanId?: string | null;
  employeeId: string;
  result: RiggingInspectionResult;
  inspectedAt: string;
  notes?: string | null;
}) {
  const { data } = await api.post<{ inspectionRecord: RiggingInspectionRecord }>('/rigging-inspection-records', payload);
  return data.inspectionRecord;
}

export async function borrowRiggingGear(payload: RiggingBorrowPayload) {
  const { data } = await api.post<{ loan: Loan }>('/rigging-gears/borrow', payload);
  return data.loan;
}

export async function returnRiggingGear(payload: RiggingReturnPayload) {
  const { data } = await api.post<{ loan: Loan }>('/rigging-gears/return', payload);
  return data.loan;
}
