import type { MachineSignalTrendDays } from '../client';

export const machineSignalQueryKeys = {
  rootAll: ['machine-signal'] as const,
  dayAll: ['machine-signal', 'day'] as const,
  settingsAll: ['machine-signal', 'settings'] as const,
  sensorsAll: ['machine-signal', 'sensors'] as const,
  importRunsAll: ['machine-signal', 'import-runs'] as const,
  day: (date?: string | null, site?: string) => ['machine-signal', 'day', date ?? 'latest', site ?? 'all'] as const,
  range: (params?: { from: string; to: string; site?: string } | null) =>
    ['machine-signal', 'range', params?.from, params?.to, params?.site ?? 'all'] as const,
  datesAll: ['machine-signal', 'dates'] as const,
  worsening: (date: string | null, site?: string) => ['machine-signal', 'worsening', date, site ?? 'all'] as const,
  trend: (signalNo: number | null, endDate: string | null, days: MachineSignalTrendDays) =>
    ['machine-signal', 'trend', signalNo, endDate, days] as const,
  adminOverviewAll: ['machine-signal', 'admin-overview'] as const,
};
