import type { MiBodyLine } from './mi-instrument-display.types.js';
import { layoutBodyWithinMaxHeight } from './layout-mi-instrument-body.js';
import { parseRowInstrumentEntries } from './row-instrument-entries.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';

const NAMES_START_YPX = 66;
const BOTTOM_PAD_PX = 12;

export type MiCardPlacement = {
  row: MiLoanInspectionTableRow;
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  bodyLines: MiBodyLine[];
};

/**
 * 4列グリッド・上揃め・行高は行内最大。縦可変1ページ分まで配置、はみ出す行は切り捨て。
 */
export function planMiInspectionCardPlacements(params: {
  rows: readonly MiLoanInspectionTableRow[];
  cardsTop: number;
  cardsAreaHeight: number;
  padding: number;
  cardWidth: number;
  cardGap: number;
  numColumns: number;
  scale: number;
}): { placements: MiCardPlacement[]; truncated: boolean; placedCount: number; totalRows: number } {
  const { rows, cardsTop, cardsAreaHeight, padding, cardWidth, cardGap, numColumns, scale } = params;
  const namesFontSize = Math.max(12, Math.round(13 * scale));
  const namesStartY = Math.round(NAMES_START_YPX * scale);
  const bottomPad = Math.round(BOTTOM_PAD_PX * scale);
  const innerTextPad = Math.round(12 * scale);
  const maxWidthPx = cardWidth - innerTextPad * 2;
  const areaBottom = cardsTop + cardsAreaHeight;

  const placements: MiCardPlacement[] = [];
  let i = 0;
  let y = cardsTop;

  while (i < rows.length) {
    const availableForRow = areaBottom - y;
    if (availableForRow <= 0) {
      break;
    }

    const batch: Array<{
      row: MiLoanInspectionTableRow;
      col: number;
      height: number;
      bodyLines: MiBodyLine[];
    }> = [];

    for (let col = 0; col < numColumns && i < rows.length; col += 1, i += 1) {
      const row = rows[i]!;
      const entries = parseRowInstrumentEntries(row);

      const laid = layoutBodyWithinMaxHeight({
        entries,
        maxWidthPx,
        baseFontPx: namesFontSize,
        scale,
        maxHeight: availableForRow,
        namesStartY,
        bottomPad,
      });
      const height = Math.min(laid.height, availableForRow);

      batch.push({ row, col, height, bodyLines: laid.bodyLines });
    }

    const rowMaxH = Math.max(...batch.map((b) => b.height));
    if (y + rowMaxH > areaBottom) {
      i -= batch.length;
      break;
    }

    for (const b of batch) {
      const x = padding + b.col * (cardWidth + cardGap);
      placements.push({
        row: b.row,
        x,
        y,
        width: cardWidth,
        height: b.height,
        col: b.col,
        bodyLines: b.bodyLines,
      });
    }
    y += rowMaxH + cardGap;
  }

  return {
    placements,
    truncated: i < rows.length,
    placedCount: placements.length,
    totalRows: rows.length,
  };
}
