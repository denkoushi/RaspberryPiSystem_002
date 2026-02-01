import type { VisualizationData, VisualizationQuery } from '../visualization.types.js';

export interface DataSource {
  readonly type: string;
  fetchData(config: VisualizationQuery): Promise<VisualizationData>;
}
