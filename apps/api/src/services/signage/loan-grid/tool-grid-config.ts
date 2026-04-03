/**
 * Grid placement contract for signage loan cards (SVG shell + inner layer).
 * Kept separate from SignageRenderer to satisfy SRP and allow strategy swapping.
 */

export type ToolCardLayoutProfile = 'default' | 'splitCompact24';

export interface ToolGridConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: 'FULL' | 'SPLIT';
  showThumbnails: boolean;
  maxRows?: number;
  maxColumns?: number;
  idealCardWidthPx?: number;
  cardHeightPx?: number;
  cardLayout?: ToolCardLayoutProfile;
}
