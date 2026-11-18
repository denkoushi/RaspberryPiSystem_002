type MeasureEm = (line: string) => number | null;

function measureWithCanvas(line: string): number | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext?.('2d');
  if (!context) return null;
  context.font = `100px ${getComputedStyle(document.body).fontFamily}`;
  const width = context.measureText(line).width;
  return width > 0 ? width / 100 : null;
}

/**
 * OCR word boxes under-size Latin text (they stop at the cap height), so fit the
 * retyped text to the width of the erased line. Both values are page-width ratios.
 */
export function fitRewriteFontSize(
  text: string,
  lineWidthRatio: number,
  heightBasedRatio: number,
  measure: MeasureEm = measureWithCanvas
): number {
  const widths = text.split('\n').map((line) => measure(line.trim()));
  const widest = Math.max(0, ...widths.map((width) => width ?? 0));
  if (!widest || widths.some((width) => width == null)) return heightBasedRatio;
  // Leave a little room so the overlay never wraps the line it replaces.
  const fitted = (lineWidthRatio * 0.95) / widest;
  return Math.min(heightBasedRatio * 1.6, Math.max(heightBasedRatio * 0.5, fitted));
}
