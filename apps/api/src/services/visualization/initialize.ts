import { getDataSourceRegistry } from './data-sources/data-source-registry.js';
import { getRendererRegistry } from './renderers/renderer-registry.js';
import { MeasuringInstrumentsDataSource } from './data-sources/measuring-instruments/index.js';
import { CsvDashboardTableDataSource } from './data-sources/csv-dashboard-table/index.js';
import { ProductionScheduleDataSource } from './data-sources/production-schedule/index.js';
import { UninspectedMachinesDataSource } from './data-sources/uninspected-machines/index.js';
import { KpiCardsRenderer } from './renderers/kpi-cards/index.js';
import { BarChartRenderer } from './renderers/bar-chart/index.js';
import { TableRenderer } from './renderers/table/index.js';
import { ProgressListRenderer } from './renderers/progress-list/index.js';
import { UninspectedMachinesRenderer } from './renderers/uninspected-machines/index.js';

export function initializeVisualizationModules(): void {
  const dataSourceRegistry = getDataSourceRegistry();
  const rendererRegistry = getRendererRegistry();

  if (!dataSourceRegistry.has('measuring_instruments')) {
    dataSourceRegistry.register(new MeasuringInstrumentsDataSource());
  }

  if (!dataSourceRegistry.has('csv_dashboard_table')) {
    dataSourceRegistry.register(new CsvDashboardTableDataSource());
  }

  if (!dataSourceRegistry.has('production_schedule')) {
    dataSourceRegistry.register(new ProductionScheduleDataSource());
  }

  if (!dataSourceRegistry.has('uninspected_machines')) {
    dataSourceRegistry.register(new UninspectedMachinesDataSource());
  }

  if (!rendererRegistry.has('kpi_cards')) {
    rendererRegistry.register(new KpiCardsRenderer());
  }

  if (!rendererRegistry.has('bar_chart')) {
    rendererRegistry.register(new BarChartRenderer());
  }

  if (!rendererRegistry.has('table')) {
    rendererRegistry.register(new TableRenderer());
  }

  if (!rendererRegistry.has('progress_list')) {
    rendererRegistry.register(new ProgressListRenderer());
  }

  if (!rendererRegistry.has('uninspected_machines')) {
    rendererRegistry.register(new UninspectedMachinesRenderer());
  }
}
