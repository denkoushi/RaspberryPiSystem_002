import type { getCsvDashboards, getVisualizationDashboards } from '../client';

export const csvVisualizationQueryKeys = {
  csvDashboardsAll: ['csv-dashboards'] as const,
  csvDashboard: (id?: string | null) => ['csv-dashboard', id] as const,
  csvDashboards: (filters?: Parameters<typeof getCsvDashboards>[0]) => ['csv-dashboards', filters] as const,
  visualizationDashboards: (filters?: Parameters<typeof getVisualizationDashboards>[0]) =>
    ['visualization-dashboards', filters] as const,
  visualizationDashboardsAll: ['visualization-dashboards'] as const,
  visualizationDashboard: (id?: string | null) => ['visualization-dashboard', id] as const,
};
