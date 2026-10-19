import { describe, expect, it } from 'vitest';

import { csvVisualizationQueryKeys } from './csvVisualization';

describe('csvVisualizationQueryKeys', () => {
  it('preserves constant keys and invalidation prefix lengths', () => {
    expect(csvVisualizationQueryKeys.visualizationDashboardsAll).toEqual(['visualization-dashboards']);
  });

  it('preserves csvDashboards values, argument order and boundary values', () => {
    expect(csvVisualizationQueryKeys.csvDashboards({ enabled: false, search: 'csv' })).toEqual(['csv-dashboards', { enabled: false, search: 'csv' }]);
    expect(csvVisualizationQueryKeys.csvDashboards()).toEqual(['csv-dashboards', undefined]);
    expect(csvVisualizationQueryKeys.csvDashboards(undefined)).toEqual(['csv-dashboards', undefined]);
    expect(csvVisualizationQueryKeys.csvDashboards({})).toEqual(['csv-dashboards', {}]);
    expect(Reflect.apply(csvVisualizationQueryKeys.csvDashboards, undefined, [null])).toEqual(['csv-dashboards', null]);
  });

  it('preserves visualizationDashboards values, argument order and boundary values', () => {
    expect(csvVisualizationQueryKeys.visualizationDashboards({ enabled: true, search: 'chart' })).toEqual(['visualization-dashboards', { enabled: true, search: 'chart' }]);
    expect(csvVisualizationQueryKeys.visualizationDashboards()).toEqual(['visualization-dashboards', undefined]);
    expect(csvVisualizationQueryKeys.visualizationDashboards(undefined)).toEqual(['visualization-dashboards', undefined]);
    expect(csvVisualizationQueryKeys.visualizationDashboards({})).toEqual(['visualization-dashboards', {}]);
    expect(Reflect.apply(csvVisualizationQueryKeys.visualizationDashboards, undefined, [null])).toEqual(['visualization-dashboards', null]);
  });

  it('preserves visualizationDashboard values, argument order and boundary values', () => {
    expect(csvVisualizationQueryKeys.visualizationDashboard('dashboard-1')).toEqual(['visualization-dashboard', 'dashboard-1']);
    expect(csvVisualizationQueryKeys.visualizationDashboard()).toEqual(['visualization-dashboard', undefined]);
    expect(csvVisualizationQueryKeys.visualizationDashboard(undefined)).toEqual(['visualization-dashboard', undefined]);
    expect(Reflect.apply(csvVisualizationQueryKeys.visualizationDashboard, undefined, [{}])).toEqual(['visualization-dashboard', {}]);
    expect(csvVisualizationQueryKeys.visualizationDashboard(null)).toEqual(['visualization-dashboard', null]);
  });
});
