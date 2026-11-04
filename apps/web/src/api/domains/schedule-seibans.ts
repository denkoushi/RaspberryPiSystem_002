import { api } from '../http';

export type SchedulePartState = 'shelf' | 'verified' | 'pending' | 'done';
export type ScheduleSeibanPart = {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  state: SchedulePartState;
  shelfCodeRaw?: string;
  shelfLabel?: string;
};
export type ScheduleSeiban = {
  fseiban: string;
  aliasFseibans: string[];
  partsCompleteDate: string | null;
  sendOutDate: string | null;
  outsourceMarks: string[];
  memo: string | null;
  machineName: string | null;
  counts: Record<SchedulePartState, number>;
};
export type ScheduleSeibanDetail = ScheduleSeiban & { parts: ScheduleSeibanPart[] };

export async function getScheduleSeibans() {
  const { data } = await api.get<{ seibans: ScheduleSeiban[]; truncated: boolean }>('/mobile-placement/schedule-seibans');
  return data;
}

export async function getScheduleSeiban(fseiban: string) {
  const { data } = await api.get<ScheduleSeibanDetail>(`/mobile-placement/schedule-seibans/${encodeURIComponent(fseiban)}`);
  return data;
}
