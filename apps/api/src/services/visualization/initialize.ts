import { getDataSourceRegistry } from './data-sources/data-source-registry.js';
import { getRendererRegistry } from './renderers/renderer-registry.js';
import { MeasuringInstrumentsDataSource } from './data-sources/measuring-instruments/index.js';
import { KpiCardsRenderer } from './renderers/kpi-cards/index.js';
import { BarChartRenderer } from './renderers/bar-chart/index.js';

export function initializeVisualizationModules(): void {
  const dataSourceRegistry = getDataSourceRegistry();
  const rendererRegistry = getRendererRegistry();

  if (!dataSourceRegistry.has('measuring_instruments')) {
    dataSourceRegistry.register(new MeasuringInstrumentsDataSource());
  }

  if (!rendererRegistry.has('kpi_cards')) {
    rendererRegistry.register(new KpiCardsRenderer());
  }

  if (!rendererRegistry.has('bar_chart')) {
    rendererRegistry.register(new BarChartRenderer());
  }
}
