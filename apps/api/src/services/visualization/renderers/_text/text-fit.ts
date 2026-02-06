export function estimateMaxCharsPerLine(availableWidthPx: number, fontPx: number): number {
  const approxCharWidth = Math.max(6, fontPx * 0.55);
  return Math.max(6, Math.floor(availableWidthPx / approxCharWidth));
}

export function truncateToFit(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
