import { describe, expect, it } from 'vitest';

import { csvVisualizationQueryKeys } from './csvVisualization';

describe('csvVisualizationQueryKeys additional keys', () => {
  it('preserves the dashboards invalidation prefix and enabled filter', () => {
    expect(csvVisualizationQueryKeys.csvDashboardsAll).toEqual(['csv-dashboards']);
    expect(csvVisualizationQueryKeys.csvDashboards({ enabled: true })).toEqual(['csv-dashboards', { enabled: true }]);
  });

  it('preserves dashboard values and boundary values', () => {
    expect(csvVisualizationQueryKeys.csvDashboard('dashboard-1')).toEqual(['csv-dashboard', 'dashboard-1']);
    expect(csvVisualizationQueryKeys.csvDashboard()).toEqual(['csv-dashboard', undefined]);
    expect(csvVisualizationQueryKeys.csvDashboard(undefined)).toEqual(['csv-dashboard', undefined]);
    expect(csvVisualizationQueryKeys.csvDashboard(null)).toEqual(['csv-dashboard', null]);
    expect(Reflect.apply(csvVisualizationQueryKeys.csvDashboard, undefined, [{}])).toEqual(['csv-dashboard', {}]);
  });
});
