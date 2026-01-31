import type { RenderConfig, RenderOutput, VisualizationData } from '../visualization.types.js';

export interface Renderer {
  readonly type: string;
  render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput>;
}
