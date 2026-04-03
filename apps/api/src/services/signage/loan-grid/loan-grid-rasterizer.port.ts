import type { LoanGridLayout } from './loan-card-grid.dto.js';
import type { ToolGridConfig } from './tool-grid-config.js';

export type LoanGridLayerResult =
  | { kind: 'svg_fragment'; fragment: string; overflowCount: number }
  | { kind: 'raster_png'; pngBuffer: Buffer; overflowCount: number };

export type LoanGridRenderRequest = {
  canvasWidth: number;
  config: ToolGridConfig;
  layout: LoanGridLayout;
};

/**
 * Renders the loan card grid area (one layer inside the parent signage SVG or JPEG pipeline).
 */
export interface LoanGridRasterizerPort {
  render(request: LoanGridRenderRequest): Promise<LoanGridLayerResult>;
}
