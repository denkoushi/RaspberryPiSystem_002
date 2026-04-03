/**
 * Geometry for SPLIT compact (4×6) loan cards. Pure functions for signage SVG.
 *
 * Card content (hasThumbnail):
 * - Employee name: full card width, above photo
 * - Photo: fixed size (caller), top-left below name
 * - Item name: 2 lines, right of photo (same vertical band as photo)
 * - Location: 2 lines, below item name, right column
 * - Date (・): below photo, left column
 * - Optional warning: same baseline as date, to the right of date (saves vertical space)
 */

/** Ideal card width (px at current scale) so floor((W+g)/(I+g)) >= desiredColumns. */
export function idealCardWidthForColumnCount(contentWidth: number, gap: number, columnCount: number): number {
  if (columnCount < 1) {
    return 200;
  }
  const w = Math.floor((contentWidth + gap) / columnCount - gap - 1);
  return Math.max(100, w);
}

export type SplitCompact24Layout = {
  thumbnailX: number;
  thumbnailY: number;
  /** Employee name — full width, above thumbnail */
  nameX: number;
  nameY: number;
  textX: number;
  textMaxX: number;
  primary1Y: number;
  primary2Y: number;
  loc1Y: number;
  loc2Y: number;
  dateX: number;
  dateY: number;
  /** Warning shares baseline with date; X is start of warning segment */
  warningX: number | null;
  warningY: number | null;
  fontPrimary: number;
  fontName: number;
  fontLoc: number;
  fontDate: number;
  fontWarning: number;
  maxLocationUnitsPerLine: number;
  maxPrimaryUnitsPerLine: number;
  maxEmployeeUnitsPerLine: number;
};

export function computeSplitCompact24Layout(params: {
  x: number;
  y: number;
  cardWidth: number;
  cardHeight: number;
  scale: number;
  cardPadding: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  thumbnailGap: number;
  hasThumbnail: boolean;
  hasWarning: boolean;
}): SplitCompact24Layout {
  const {
    x,
    y,
    cardWidth,
    scale,
    cardPadding,
    thumbnailWidth,
    thumbnailHeight,
    thumbnailGap,
    hasThumbnail,
    hasWarning,
  } = params;

  const fontPrimary = Math.max(13, Math.round(16 * scale));
  const fontName = Math.max(12, Math.round(14 * scale));
  const fontLoc = Math.max(11, Math.round(12 * scale));
  const fontDate = Math.max(11, Math.round(13 * scale));
  const fontWarning = Math.max(10, Math.round(11 * scale));

  const nameX = x + cardPadding;
  const innerW = cardWidth - cardPadding * 2;
  const maxEmployeeUnitsPerLine = Math.max(4, Math.min(32, Math.floor(innerW / 7)));

  /** First text baseline below top padding (employee name). */
  const nameY = y + cardPadding + Math.round(13 * scale);
  const gapBelowName = Math.round(8 * scale);

  const thumbnailX = x + cardPadding;
  const thumbnailY = nameY + gapBelowName;

  const textX = hasThumbnail ? thumbnailX + thumbnailWidth + thumbnailGap : x + cardPadding;
  const textMaxX = x + cardWidth - cardPadding;
  const textColumnPx = textMaxX - textX;
  const maxForCol = Math.max(4, Math.min(24, Math.floor(textColumnPx / 7)));
  const maxLocationUnitsPerLine = maxForCol;
  const maxPrimaryUnitsPerLine = maxForCol;

  const lhPrimaryStep = Math.round(15 * scale);
  const lhLocStep = Math.round(13 * scale);
  const blockGap = Math.round(6 * scale);

  const primary1Y = thumbnailY + Math.round(14 * scale);
  const primary2Y = primary1Y + lhPrimaryStep;
  const loc1Y = primary2Y + blockGap;
  const loc2Y = loc1Y + lhLocStep;

  const dateX = x + cardPadding;
  const dateY = thumbnailY + thumbnailHeight + Math.round(4 * scale);

  let warningX: number | null = null;
  let warningY: number | null = null;
  if (hasWarning) {
    warningY = dateY;
    /** Avoid drawing past card inner edge when column is very narrow. */
    warningX = Math.min(dateX + Math.round(92 * scale), textMaxX - Math.round(52 * scale));
  }

  return {
    thumbnailX,
    thumbnailY,
    nameX,
    nameY,
    textX,
    textMaxX,
    primary1Y,
    primary2Y,
    loc1Y,
    loc2Y,
    dateX,
    dateY,
    warningX,
    warningY,
    fontPrimary,
    fontName,
    fontLoc,
    fontDate,
    fontWarning,
    maxLocationUnitsPerLine,
    maxPrimaryUnitsPerLine,
    maxEmployeeUnitsPerLine,
  };
}
