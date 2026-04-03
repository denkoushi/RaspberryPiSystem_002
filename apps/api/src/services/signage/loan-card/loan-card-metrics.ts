/**
 * Width / vertical metrics for SVG loan cards (font-size in px at current render scale).
 * Centralizes magic numbers so layout and text splitting stay aligned (SRP).
 */

/** CJK-heavy line: approximate width-units limit from column px and font size. */
export function maxWidthUnitsForFont(columnWidthPx: number, fontSizePx: number): number {
  if (columnWidthPx <= 0 || fontSizePx <= 0) {
    return 4;
  }
  /** ~0.9em per full-width char at this fontSize in SVG sans-serif */
  const pxPerFullWidthUnit = Math.max(8, fontSizePx * 0.88);
  return Math.max(3, Math.min(22, Math.floor(columnWidthPx / pxPerFullWidthUnit)));
}

/** Reserve for bottom row (date + optional warning); keeps date baseline clear of photo bottom. */
export function gapFromPhotoBottomToDateBaseline(fontDatePx: number, scale: number): number {
  /** Extra margin helps SVG→raster (sharp) where ascenders read larger than nominal font-size. */
  return Math.round(Math.max(12, fontDatePx + 6 * scale));
}
