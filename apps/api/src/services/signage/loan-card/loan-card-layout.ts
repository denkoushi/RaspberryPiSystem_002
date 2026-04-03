/**
 * Geometry for SPLIT compact (4×6) loan cards. Pure functions for signage SVG.
 *
 * Card content (hasThumbnail):
 * - Employee name: full card width, above photo
 * - Photo: fixed size (caller), top-left below name
 * - Item name: 2 lines, right of photo (same vertical band as photo)
 * - Location: 2 lines, below item name, right column
 * - Date (・): same bottom baseline as management id (left); ink stays below photo
 * - Optional warning: same baseline as date, to the right of date (saves vertical space)
 */

import { gapFromPhotoBottomToDateBaseline, maxWidthUnitsForFont } from './loan-card-metrics.js';

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
    cardHeight,
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
  const maxEmployeeUnitsPerLine = maxWidthUnitsForFont(innerW, fontName);

  /** First text baseline below top padding (employee name). */
  const nameY = y + cardPadding + Math.round(13 * scale);
  /** Space below name baseline before photo (baseline is not the visible bottom of glyphs). */
  const minGapNameBaselineToThumbTop = Math.round(Math.max(10 * scale, fontName * 0.32 + 6 * scale));

  const thumbnailX = x + cardPadding;

  const textX = hasThumbnail ? thumbnailX + thumbnailWidth + thumbnailGap : x + cardPadding;
  const textMaxX = x + cardWidth - cardPadding;
  const textColumnPx = Math.max(0, textMaxX - textX);
  const maxPrimaryUnitsPerLine = maxWidthUnitsForFont(textColumnPx, fontPrimary);
  const maxLocationUnitsPerLine = maxWidthUnitsForFont(textColumnPx, fontLoc);

  /** Bottom inner edge: same baseline as management id in renderer (right-aligned). */
  const bottomRowBaseline = y + cardHeight - cardPadding;
  const minThumbTop = nameY + minGapNameBaselineToThumbTop;
  const innerTop = y + cardPadding;

  /**
   * Vertical budget: photo top >= `minThumbTop` (clear of name baseline / descenders).
   * Photo bottom <= `bottomRowBaseline - dateInk` (room for date ascenders; date is painted after image).
   * When the preferred `dateInk` is too large, shrink it toward the minimum needed to fit the name row.
   */
  const dateInkPreferred = gapFromPhotoBottomToDateBaseline(fontDate, scale);
  const dateInkAbsoluteFloor = 6;

  let dateInkClearancePx = dateInkPreferred;
  let maxPhotoBottom = bottomRowBaseline - dateInkClearancePx;
  let thumbTopMax = maxPhotoBottom - thumbnailHeight;

  if (thumbTopMax < minThumbTop) {
    const inkNeededForName = bottomRowBaseline - minThumbTop - thumbnailHeight;
    dateInkClearancePx = Math.max(dateInkAbsoluteFloor, Math.min(dateInkPreferred, inkNeededForName));
    maxPhotoBottom = bottomRowBaseline - dateInkClearancePx;
    thumbTopMax = maxPhotoBottom - thumbnailHeight;
  }

  /** As low as layout allows: maximizes clearance under the name; uses slack between photo and date. */
  let thumbnailY = Math.max(innerTop, minThumbTop, thumbTopMax);
  if (thumbnailY + thumbnailHeight > maxPhotoBottom) {
    thumbnailY = Math.max(innerTop, thumbTopMax);
  }


  const lhPrimaryStep = Math.round(15 * scale);
  const lhLocStep = Math.round(13 * scale);
  const blockGap = Math.round(6 * scale);

  const primary1Y = thumbnailY + Math.round(14 * scale);
  const primary2Y = primary1Y + lhPrimaryStep;
  const loc1Y = primary2Y + blockGap;
  const loc2Y = loc1Y + lhLocStep;

  const dateX = x + cardPadding;
  const dateY = bottomRowBaseline;

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
