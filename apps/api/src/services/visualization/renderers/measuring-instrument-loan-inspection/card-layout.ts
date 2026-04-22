import { layoutInstrumentNameLines } from './instrument-name-text.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 1カード内の名称行の上限（長文化けつつ1ページ枠内に収めやすくする） */
export const MAX_INSTRUMENT_NAME_LINES = 32;

const NAMES_START_YPX = 66;
const BOTTOM_PAD_PX = 12;

export type MiCardPlacement = {
  row: MiLoanInspectionTableRow;
  x: number;
  y: number;
  width: number;
  height: number;
  col: number;
  namesLines: string[];
};

/**
 * 名称折り返し行数の上限を下げながら、与えた最大高以下に収まる lines と高さを求める。
 */
function layoutNamesWithinMaxHeight(params: {
  namesText: string;
  maxWidthPx: number;
  namesFontSize: number;
  lineHeight: number;
  maxHeight: number;
  namesStartY: number;
  bottomPad: number;
}): { namesLines: string[]; height: number } {
  const { maxHeight, namesStartY, bottomPad, lineHeight, namesText, maxWidthPx, namesFontSize } = params;
  const maxTextHeight = maxHeight - namesStartY - bottomPad;
  if (maxTextHeight < lineHeight) {
    return {
      namesLines: [layoutInstrumentNameLines({ namesText, maxWidthPx, fontPx: namesFontSize, maxLines: 1 })[0] ?? '-'],
      height: namesStartY + lineHeight + bottomPad,
    };
  }
  const maxByHeight = Math.max(1, Math.floor(maxTextHeight / lineHeight));
  for (let m = Math.min(MAX_INSTRUMENT_NAME_LINES, maxByHeight); m >= 1; m -= 1) {
    const namesLines = layoutInstrumentNameLines({
      namesText: namesText || '',
      maxWidthPx,
      fontPx: namesFontSize,
      maxLines: m,
    });
    const h = namesStartY + namesLines.length * lineHeight + bottomPad;
    if (h <= maxHeight) {
      return { namesLines, height: h };
    }
  }
  const fallback = layoutInstrumentNameLines({
    namesText: namesText || '',
    maxWidthPx,
    fontPx: namesFontSize,
    maxLines: 1,
  });
  return {
    namesLines: fallback,
    height: namesStartY + Math.min(1, fallback.length) * lineHeight + bottomPad,
  };
}

/**
 * 4列グリッド・上揃え・行高は行内最大。縦可変1ページ分まで配置、はみ出す行は切り捨て。
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
  const lineHeight = Math.max(Math.round(namesFontSize * 1.35), Math.round(18 * scale));
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
      namesLines: string[];
    }> = [];

    for (let col = 0; col < numColumns && i < rows.length; col += 1, i += 1) {
      const row = rows[i]!;
      const activeLoanCount = toNumber(row['貸出中計測機器数'], 0);
      const instrumentNamesRaw = String(row['計測機器名称一覧'] ?? '').trim();
      const isEmpty = activeLoanCount <= 0;

      let height: number;
      let namesLines: string[];
      if (isEmpty) {
        namesLines = layoutInstrumentNameLines({
          namesText: '',
          maxWidthPx,
          fontPx: namesFontSize,
          maxLines: 1,
        });
        height = namesStartY + namesLines.length * lineHeight + bottomPad;
        height = Math.min(height, availableForRow);
      } else {
        const laid = layoutNamesWithinMaxHeight({
          namesText: instrumentNamesRaw,
          maxWidthPx,
          namesFontSize,
          lineHeight,
          maxHeight: availableForRow,
          namesStartY,
          bottomPad,
        });
        height = laid.height;
        namesLines = laid.namesLines;
      }

      batch.push({ row, col, height, namesLines });
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
        namesLines: b.namesLines,
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
