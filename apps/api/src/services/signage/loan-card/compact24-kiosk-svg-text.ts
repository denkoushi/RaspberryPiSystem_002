import {
  splitLocationTwoLines,
  splitPrimaryTwoLines,
  trimToUnitsWithEllipsis,
} from './loan-card-text.js';
import type { LoanCardCompactKioskLines } from '../loan-grid/loan-card-grid.dto.js';

export type Compact24KioskSvgBody = {
  headLeft: string;
  headRight?: string;
  nameLine1: string;
  nameLine2: string;
  locLine1: string;
  locLine2: string;
};

/**
 * compact24 SVG 用にキオスク本文＋拠点を既存 4 段（primary1/2, loc1/2）に割当てる。
 * 名称が 2 行に伸びた場合は拠点の 2 行目を諦める（優先度: 名称 > 拠点 2 行目）。
 */
export function buildCompact24KioskSvgBody(
  kiosk: LoanCardCompactKioskLines,
  clientLocationText: string,
  maxPrimaryUnitsPerLine: number,
  maxLocationUnitsPerLine: number,
  /** 吊具 1 行目右に載せる値の最大ユニット（左 head との干渉を避ける） */
  reserveIdUnits: number
): Compact24KioskSvgBody {
  const headMax = Math.max(
    4,
    maxPrimaryUnitsPerLine - (kiosk.idNumValue != null ? reserveIdUnits : 0)
  );
  const headLeft = trimToUnitsWithEllipsis(kiosk.headLine.trim() || '-', headMax);
  const headRight =
    kiosk.idNumValue != null
      ? trimToUnitsWithEllipsis(kiosk.idNumValue.trim() || '-', reserveIdUnits)
      : undefined;

  const nameSplit = splitPrimaryTwoLines(kiosk.nameLine.trim() || '-', maxPrimaryUnitsPerLine);
  const locSplit = splitLocationTwoLines(clientLocationText, maxLocationUnitsPerLine);

  if (nameSplit.line2) {
    return {
      headLeft,
      headRight,
      nameLine1: nameSplit.line1,
      nameLine2: nameSplit.line2,
      locLine1: locSplit.line1,
      locLine2: '',
    };
  }
  return {
    headLeft,
    headRight,
    nameLine1: nameSplit.line1,
    nameLine2: '',
    locLine1: locSplit.line1,
    locLine2: locSplit.line2,
  };
}
