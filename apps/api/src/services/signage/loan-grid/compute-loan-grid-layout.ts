import { idealCardWidthForColumnCount } from '../loan-card/loan-card-layout.js';
import type { LoanCardViewModel, LoanGridLayout, LoanGridPlacedCard } from './loan-card-grid.dto.js';
import type { ToolGridConfig } from './tool-grid-config.js';

/**
 * Shared column/row math for SVG and HTML loan grids.
 */
export function computeLoanGridLayout(
  canvasWidth: number,
  config: ToolGridConfig,
  cards: LoanCardViewModel[]
): LoanGridLayout {
  const scale = canvasWidth / 1920;
  const gap = Math.round(14 * scale);
  const desiredColumns = config.maxColumns ?? 2;

  let idealCardWidth: number;
  if (config.idealCardWidthPx != null) {
    idealCardWidth = Math.round(config.idealCardWidthPx * scale);
  } else if (config.cardLayout === 'splitCompact24' && config.maxColumns != null) {
    idealCardWidth = idealCardWidthForColumnCount(config.width, gap, config.maxColumns);
  } else {
    idealCardWidth = Math.round((config.mode === 'FULL' ? 360 : 300) * scale);
  }

  let columns = Math.max(1, Math.floor((config.width + gap) / (idealCardWidth + gap)));
  columns = Math.min(columns, desiredColumns);
  const cardWidth = Math.max(1, Math.floor((config.width - gap * (columns - 1)) / columns));
  const cardHeight =
    config.cardHeightPx != null ? Math.round(config.cardHeightPx * scale) : Math.round(140 * scale);

  const maxRows =
    config.maxRows ?? Math.max(1, Math.floor((config.height + gap) / (cardHeight + gap)));
  const maxItems = columns * maxRows;
  const displayCards = cards.slice(0, maxItems);
  const overflowCount = Math.max(0, cards.length - displayCards.length);

  const placed: LoanGridPlacedCard[] = displayCards.map((view, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      view,
      x: config.x + column * (cardWidth + gap),
      y: config.y + row * (cardHeight + gap),
      width: cardWidth,
      height: cardHeight,
    };
  });

  return {
    gap,
    columns,
    cardWidth,
    cardHeight,
    overflowCount,
    scale,
    placed,
    isEmpty: displayCards.length === 0,
  };
}
