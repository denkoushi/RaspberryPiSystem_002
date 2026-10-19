import type { getClientLogs } from '../client';

export const clientsQueryKeys = {
  clientsAll: ['clients'] as const,
  sitesAll: ['sites'] as const,
  kioskSitesAll: ['kiosk-sites'] as const,
  statusAll: ['client-status'] as const,
  alertsAll: ['client-alerts'] as const,
  logs: (filters?: Parameters<typeof getClientLogs>[0]) => ['client-logs', filters] as const,
};
