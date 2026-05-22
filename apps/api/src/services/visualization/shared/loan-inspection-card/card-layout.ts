import type { LoanInspectionBodyLine, LoanInspectionTableRow } from './display.types.js';
import { layoutBodyWithinMaxHeight } from './layout-body.js';
import {
  LOAN_INSPECTION_CARD_BOTTOM_PAD_PX,
  LOAN_INSPECTION_CARD_INNER_PAD_PX,
  LOAN_INSPECTION_NAMES_START_YPX,
} from './card-metrics.js';
import { parseRowInstrumentEntries } from './row-instrument-entries.js';

export type LoanInspectionCardPlacement = {
  row: LoanInspectionTableRow;
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  bodyLines: LoanInspectionBodyLine[];
};

export type LoanInspectionCardColumns = {
  detailColumn: string;
  namesColumn: string;
};

/**
 * 4列グリッド・上揃え・行高は行内最大。縦可変1ページ分まで配置、はみ出す行は切り捨て。
 */
export function planLoanInspectionCardPlacements(params: {
  rows: readonly LoanInspectionTableRow[];
  columns: LoanInspectionCardColumns;
  cardsTop: number;
  cardsAreaHeight: number;
  padding: number;
  cardWidth: number;
  cardGap: number;
  numColumns: number;
  scale: number;
}): { placements: LoanInspectionCardPlacement[]; truncated: boolean; placedCount: number; totalRows: number } {
  const { rows, columns, cardsTop, cardsAreaHeight, padding, cardWidth, cardGap, numColumns, scale } = params;
  const namesFontSize = Math.max(12, Math.round(13 * scale));
  const namesStartY = Math.round(LOAN_INSPECTION_NAMES_START_YPX * scale);
  const bottomPad = Math.round(LOAN_INSPECTION_CARD_BOTTOM_PAD_PX * scale);
  const innerTextPad = Math.round(LOAN_INSPECTION_CARD_INNER_PAD_PX * scale);
  const maxWidthPx = cardWidth - innerTextPad * 2;
  const areaBottom = cardsTop + cardsAreaHeight;

  const placements: LoanInspectionCardPlacement[] = [];
  let i = 0;
  let y = cardsTop;

  while (i < rows.length) {
    const availableForRow = areaBottom - y;
    if (availableForRow <= 0) {
      break;
    }

    const batch: Array<{
      row: LoanInspectionTableRow;
      col: number;
      height: number;
      bodyLines: LoanInspectionBodyLine[];
    }> = [];

    for (let col = 0; col < numColumns && i < rows.length; col += 1, i += 1) {
      const row = rows[i]!;
      const entries = parseRowInstrumentEntries(row, columns);

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
