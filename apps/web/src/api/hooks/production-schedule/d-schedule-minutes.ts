import { useQuery } from '@tanstack/react-query';

import { api } from '../../http';

export type DScheduleMinutesExtras = {
  fseiban: string;
  outsourceMarks: string[];
  surfaceSendOutDates: Array<{ date: string; note: string | null }>;
  memo: string | null;
};

export function useKioskDScheduleMinutes() {
  return useQuery({
    queryKey: ['kiosk-production-schedule', 'd-schedule-minutes'],
    queryFn: async () => (await api.get<{ rows: DScheduleMinutesExtras[] }>('/kiosk/production-schedule/d-schedule-minutes')).data,
    refetchInterval: 30000,
    refetchOnWindowFocus: false
  });
}
