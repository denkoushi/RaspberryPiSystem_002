import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  getMachineSignalAdminOverview,
  getMachineSignalDay,
  getMachineSignalImportRuns,
  getMachineSignalRange,
  getMachineSignalReportDates,
  getMachineSignalSensors,
  getMachineSignalSettings,
  getMachineSignalTrend,
  getMachineSignalWorsening,
  runMachineSignalGmailImport,
  updateMachineSignalSensor,
  updateMachineSignalSensorsBulk,
  updateMachineSignalSettings,
  type MachineSignalTrendDays
} from '../client';

const ROOT_KEY = ['machine-signal'] as const;
const DAY_KEY = [...ROOT_KEY, 'day'] as const;
const SETTINGS_KEY = [...ROOT_KEY, 'settings'] as const;
const SENSORS_KEY = [...ROOT_KEY, 'sensors'] as const;
const RUNS_KEY = [...ROOT_KEY, 'import-runs'] as const;

/** 日報は1日1回届くので、開いたままのキオスクでも10分ごとに読み直せば足りる。 */
const DAY_REFETCH_MS = 600_000;

const HISTORY_STALE_MS = 30 * 60_000;

export function useMachineSignalDay(params: { date?: string; site?: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...DAY_KEY, params.date ?? 'latest', params.site ?? 'all'],
    queryFn: () => getMachineSignalDay(params),
    staleTime: params.date ? HISTORY_STALE_MS : 0,
    refetchInterval: params.date ? false : DAY_REFETCH_MS,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous
  });
  const previousDate = query.data?.previousDate;
  useEffect(() => {
    if (!previousDate || query.isPlaceholderData) return;
    void queryClient.prefetchQuery({
      queryKey: [...DAY_KEY, previousDate, params.site ?? 'all'],
      queryFn: () => getMachineSignalDay({ date: previousDate, site: params.site }),
      staleTime: HISTORY_STALE_MS
    });
  }, [previousDate, params.site, query.isPlaceholderData, queryClient]);
  return query;
}

export function useMachineSignalRange(params: { from: string; to: string; site?: string } | null) {
  return useQuery({
    queryKey: [...ROOT_KEY, 'range', params?.from, params?.to, params?.site ?? 'all'],
    queryFn: () => getMachineSignalRange(params!),
    enabled: params !== null,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false
  });
}

export function useMachineSignalReportDates() {
  return useQuery({ queryKey: [...ROOT_KEY, 'dates'], queryFn: getMachineSignalReportDates, refetchOnWindowFocus: false });
}

export function useMachineSignalWorsening(params: { date: string | null; site?: string }) {
  return useQuery({
    queryKey: [...ROOT_KEY, 'worsening', params.date, params.site ?? 'all'],
    queryFn: () => getMachineSignalWorsening({ date: params.date!, site: params.site }),
    enabled: params.date !== null,
    refetchOnWindowFocus: false
  });
}

export function useMachineSignalTrend(params: { signalNo: number | null; endDate: string | null; days: MachineSignalTrendDays }) {
  const { signalNo, endDate, days } = params;
  return useQuery({
    queryKey: [...ROOT_KEY, 'trend', signalNo, endDate, days],
    queryFn: () => getMachineSignalTrend({ signalNo: signalNo as number, endDate: endDate as string, days }),
    enabled: signalNo !== null && endDate !== null,
    refetchOnWindowFocus: false
  });
}

export function useMachineSignalSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: getMachineSignalSettings, refetchOnWindowFocus: false });
}

export function useUpdateMachineSignalSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMachineSignalSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
      void queryClient.invalidateQueries({ queryKey: DAY_KEY });
    }
  });
}

export function useMachineSignalSensors() {
  return useQuery({ queryKey: SENSORS_KEY, queryFn: getMachineSignalSensors, refetchOnWindowFocus: false });
}

export function useUpdateMachineSignalSensor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMachineSignalSensor,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT_KEY })
  });
}

export function useUpdateMachineSignalSensorsBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMachineSignalSensorsBulk,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT_KEY })
  });
}

export function useMachineSignalAdminOverview() {
  return useQuery({
    queryKey: [...ROOT_KEY, 'admin-overview'],
    queryFn: getMachineSignalAdminOverview,
    refetchOnWindowFocus: false
  });
}

export function useMachineSignalImportRuns() {
  return useQuery({ queryKey: RUNS_KEY, queryFn: getMachineSignalImportRuns, refetchOnWindowFocus: false });
}

export function useRunMachineSignalGmailImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: runMachineSignalGmailImport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT_KEY })
  });
}

/** 一括取り込みの後に、取り込み履歴・センサー・画面の集計を読み直す。 */
export function useInvalidateMachineSignal() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROOT_KEY });
}
