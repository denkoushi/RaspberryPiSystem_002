/**
 * Geometry for SPLIT compact (4×6) loan cards. Pure functions for signage SVG.
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
  textX: number;
  /** Right padding boundary for monospace management text (from card left). */
  textMaxX: number;
  primaryY: number;
  nameY: number;
  warningY: number | null;
  loc1Y: number;
  loc2Y: number;
  dateY: number;
  fontPrimary: number;
  fontName: number;
  fontLoc: number;
  fontDate: number;
  fontWarning: number;
  /** Max width units (loan-card-text) per location line. */
  maxLocationUnitsPerLine: number;
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
  const fontWarning = Math.max(11, Math.round(12 * scale));

  const thumbnailX = x + cardPadding;
  const thumbnailY = y + cardPadding;

  const textX = x + cardPadding + (hasThumbnail ? thumbnailWidth + thumbnailGap : 0);
  const textMaxX = x + cardWidth - cardPadding;

  const textColumnPx = textMaxX - textX;
  const maxLocationUnitsPerLine = Math.max(4, Math.min(24, Math.floor(textColumnPx / 7)));

  const thumbBottomBaseline = hasThumbnail
    ? thumbnailY + thumbnailHeight - Math.round(3 * scale)
    : y + cardHeight - cardPadding - Math.round(20 * scale);

  const dateY = thumbBottomBaseline;

  const gap = Math.round(4 * scale);
  const lhLoc = Math.round(13 * scale);
  const lhWarn = Math.round(13 * scale);
  const lhName = Math.round(15 * scale);
  const lhPrimary = Math.round(17 * scale);

  /**
   * Top-to-bottom on screen: primary → name → loc1 → loc2 → (warning if any) → date.
   * Build baselines upward from date (smaller Y = higher on screen).
   */
  let yLine = dateY - Math.round(8 * scale);
  let warningY: number | null = null;
  if (hasWarning) {
    warningY = yLine;
    yLine -= lhWarn + gap;
  }
  const loc2Y = yLine;
  yLine -= lhLoc + gap;
  const loc1Y = yLine;
  yLine -= lhLoc + gap;

  const nameY = yLine;
  yLine -= lhName + gap;
  let primaryY = yLine;

  const topMin = y + cardPadding + lhPrimary;
  if (primaryY < topMin) {
    primaryY = topMin;
  }

  return {
    thumbnailX,
    thumbnailY,
    textX,
    textMaxX,
    primaryY,
    nameY,
    warningY,
    loc1Y,
    loc2Y,
    dateY,
    fontPrimary,
    fontName,
    fontLoc,
    fontDate,
    fontWarning,
    maxLocationUnitsPerLine,
  };
}
