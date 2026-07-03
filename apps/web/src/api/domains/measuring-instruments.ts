import { api } from '../http';

import type {
  InspectionItem,
  InspectionRecord,
  InspectionRecordCreatePayload,
  Loan,
  MeasuringInstrument,
  MeasuringInstrumentBorrowPayload,
  MeasuringInstrumentGenre,
  MeasuringInstrumentReturnPayload,
  MeasuringInstrumentStatus,
  MeasuringInstrumentTag,
} from '../types';
// 計測機器 API
export async function getMeasuringInstruments(params?: {
  search?: string;
  status?: MeasuringInstrumentStatus;
}) {
  const { data } = await api.get<{ instruments: MeasuringInstrument[] }>('/measuring-instruments', {
    params
  });
  return data.instruments;
}

export interface UnifiedItem {
  id: string;
  type: 'TOOL' | 'MEASURING_INSTRUMENT' | 'RIGGING_GEAR';
  name: string;
  code: string;
  category?: string | null;
  storageLocation?: string | null;
  status: string;
  nfcTagUid?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedListParams {
  search?: string;
  category?: 'TOOLS' | 'MEASURING_INSTRUMENTS' | 'RIGGING_GEARS' | 'ALL';
  itemStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  instrumentStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
  riggingStatus?: 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'RETIRED';
}

// 計測機器作成/更新用の入力
export type MeasuringInstrumentInput = Partial<MeasuringInstrument> & {
  rfidTagUid?: string | null;
};

export type MeasuringInstrumentGenreInput = {
  name: string;
};

export async function getUnifiedItems(params?: UnifiedListParams) {
  const { data } = await api.get<{ items: UnifiedItem[] }>('/tools/unified', {
    params: {
      ...params,
      category: params?.category ?? 'ALL'
    }
  });
  return data.items;
}

export async function getMeasuringInstrument(id: string) {
  const { data } = await api.get<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`);
  return data.instrument;
}

export async function getMeasuringInstrumentGenres() {
  const { data } = await api.get<{ genres: MeasuringInstrumentGenre[] }>('/measuring-instrument-genres');
  return data.genres;
}

export async function createMeasuringInstrumentGenre(input: MeasuringInstrumentGenreInput) {
  const { data } = await api.post<{ genre: MeasuringInstrumentGenre }>('/measuring-instrument-genres', input);
  return data.genre;
}

export async function updateMeasuringInstrumentGenre(
  genreId: string,
  input: Partial<Pick<MeasuringInstrumentGenre, 'name' | 'imageUrlPrimary' | 'imageUrlSecondary'>>
) {
  const { data } = await api.put<{ genre: MeasuringInstrumentGenre }>(`/measuring-instrument-genres/${genreId}`, input);
  return data.genre;
}

export async function deleteMeasuringInstrumentGenre(genreId: string) {
  const { data } = await api.delete<{ genre: MeasuringInstrumentGenre }>(`/measuring-instrument-genres/${genreId}`);
  return data.genre;
}

export async function uploadMeasuringInstrumentGenreImage(genreId: string, slot: 1 | 2, image: File) {
  const form = new FormData();
  form.append('image', image);
  const { data } = await api.post<{ genre: MeasuringInstrumentGenre }>(
    `/measuring-instrument-genres/${genreId}/images/${slot}`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' }
    }
  );
  return data.genre;
}

export async function deleteMeasuringInstrumentGenreImage(genreId: string, slot: 1 | 2) {
  const { data } = await api.delete<{ genre: MeasuringInstrumentGenre }>(
    `/measuring-instrument-genres/${genreId}/images/${slot}`
  );
  return data.genre;
}

export async function getMeasuringInstrumentByTagUid(tagUid: string) {
  const { data } = await api.get<{ instrument: MeasuringInstrument }>(`/measuring-instruments/by-tag/${tagUid}`);
  return data.instrument;
}

export async function getMeasuringInstrumentTags(instrumentId: string) {
  const { data } = await api.get<{ tags: MeasuringInstrumentTag[] }>(`/measuring-instruments/${instrumentId}/tags`);
  return data;
}

export async function createMeasuringInstrument(input: MeasuringInstrumentInput) {
  const { data } = await api.post<{ instrument: MeasuringInstrument }>('/measuring-instruments', input);
  return data.instrument;
}

export async function updateMeasuringInstrument(id: string, input: MeasuringInstrumentInput) {
  const { data } = await api.put<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`, input);
  return data.instrument;
}

export async function deleteMeasuringInstrument(id: string) {
  const { data } = await api.delete<{ instrument: MeasuringInstrument }>(`/measuring-instruments/${id}`);
  return data.instrument;
}

// 点検項目 API
export async function getInspectionItems(measuringInstrumentId: string) {
  const { data } = await api.get<{ inspectionItems: InspectionItem[] }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-items`
  );
  return data.inspectionItems;
}

export async function getGenreInspectionItems(genreId: string) {
  const { data } = await api.get<{ inspectionItems: InspectionItem[] }>(
    `/measuring-instrument-genres/${genreId}/inspection-items`
  );
  return data.inspectionItems;
}

export async function createGenreInspectionItem(genreId: string, input: Partial<InspectionItem>) {
  const { data } = await api.post<{ inspectionItem: InspectionItem }>(
    `/measuring-instrument-genres/${genreId}/inspection-items`,
    input
  );
  return data.inspectionItem;
}

export async function getMeasuringInstrumentInspectionProfile(measuringInstrumentId: string) {
  const { data } = await api.get<{
    genre: MeasuringInstrumentGenre | null;
    inspectionItems: InspectionItem[];
  }>(`/measuring-instruments/${measuringInstrumentId}/inspection-profile`);
  return data;
}

export async function createInspectionItem(measuringInstrumentId: string, input: Partial<InspectionItem>) {
  const { data } = await api.post<{ inspectionItem: InspectionItem }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-items`,
    input
  );
  return data.inspectionItem;
}

export async function updateInspectionItem(itemId: string, input: Partial<InspectionItem>) {
  const { data } = await api.put<{ inspectionItem: InspectionItem }>(`/inspection-items/${itemId}`, input);
  return data.inspectionItem;
}

export async function deleteInspectionItem(itemId: string) {
  const { data } = await api.delete<{ inspectionItem: InspectionItem }>(`/inspection-items/${itemId}`);
  return data.inspectionItem;
}

// RFIDタグ API
export async function getInstrumentTags(measuringInstrumentId: string) {
  const { data } = await api.get<{ tags: MeasuringInstrumentTag[] }>(
    `/measuring-instruments/${measuringInstrumentId}/tags`
  );
  return data.tags;
}

export async function createInstrumentTag(measuringInstrumentId: string, rfidTagUid: string) {
  const { data } = await api.post<{ tag: MeasuringInstrumentTag }>(
    `/measuring-instruments/${measuringInstrumentId}/tags`,
    { rfidTagUid }
  );
  return data.tag;
}

export async function deleteInstrumentTag(tagId: string) {
  const { data } = await api.delete<{ tag: MeasuringInstrumentTag }>(`/measuring-instruments/tags/${tagId}`);
  return data.tag;
}

// 点検記録 API
export async function getInspectionRecords(
  measuringInstrumentId: string,
  filters?: { startDate?: string; endDate?: string; employeeId?: string; result?: string }
) {
  const { data } = await api.get<{ inspectionRecords: InspectionRecord[] }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-records`,
    { params: filters }
  );
  return data.inspectionRecords;
}

export async function createInspectionRecord(payload: InspectionRecordCreatePayload) {
  const { measuringInstrumentId, ...rest } = payload;
  const { data } = await api.post<{ inspectionRecord: InspectionRecord }>(
    `/measuring-instruments/${measuringInstrumentId}/inspection-records`,
    rest
  );
  return data.inspectionRecord;
}

// 計測機器の持出/返却
export async function borrowMeasuringInstrument(payload: MeasuringInstrumentBorrowPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/measuring-instruments/borrow', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}

export async function returnMeasuringInstrument(payload: MeasuringInstrumentReturnPayload, clientKey?: string) {
  const { data } = await api.post<{ loan: Loan }>('/measuring-instruments/return', payload, {
    headers: clientKey ? { 'x-client-key': clientKey } : undefined
  });
  return data.loan;
}
