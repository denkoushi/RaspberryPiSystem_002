import { useQuery } from '@tanstack/react-query';

import { getScheduleSeiban, getScheduleSeibans, type ScheduleSeibanView } from '../domains/schedule-seibans';

export const scheduleSeibanQueryKey = ['mobile-placement', 'schedule-seibans'] as const;

export function useScheduleSeibans(view: ScheduleSeibanView = { source: 'both', range: 'all' }) {
  return useQuery({ queryKey: [...scheduleSeibanQueryKey, view], queryFn: () => getScheduleSeibans(view), refetchInterval: 60_000 });
}

export function useScheduleSeiban(fseiban?: string) {
  return useQuery({ queryKey: [...scheduleSeibanQueryKey, fseiban], queryFn: () => getScheduleSeiban(fseiban!), enabled: Boolean(fseiban), refetchInterval: 60_000 });
}
