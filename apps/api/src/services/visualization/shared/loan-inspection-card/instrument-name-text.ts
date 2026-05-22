export function estimateTextWidth(text: string, fontPx: number): number {
  let usedEm = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    usedEm += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return Math.round(usedEm * fontPx);
}

export function truncateWithEllipsis(text: string, maxWidthPx: number, fontPx: number): string {
  if (!text) return '-';
  if (estimateTextWidth(text, fontPx) <= maxWidthPx) return text;
  const ellipsis = '...';
  let out = '';
  for (const ch of text) {
    const next = out + ch;
    if (estimateTextWidth(next + ellipsis, fontPx) > maxWidthPx) {
      break;
    }
    out = next;
  }
  return out ? `${out}${ellipsis}` : ellipsis;
}
