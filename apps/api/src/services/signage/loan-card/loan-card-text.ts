/**
 * Pure text helpers for SPLIT compact loan cards (signage SVG).
 * Kept separate from SignageRenderer for testability (SRP).
 */

function isAsciiChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  return cp !== undefined && cp <= 0x7f;
}

/** Approximate width units: ASCII 0.5, else 1 (CJK). */
export function textWidthUnits(s: string): number {
  let u = 0;
  for (const ch of s) {
    u += isAsciiChar(ch) ? 0.5 : 1;
  }
  return u;
}

/** Trim string to max units, appending ellipsis if truncated. */
export function trimToUnitsWithEllipsis(s: string, maxUnits: number): string {
  if (maxUnits <= 1) {
    return '…';
  }
  const ell = '…';
  const ellW = textWidthUnits(ell);
  let acc = '';
  let accW = 0;
  for (const ch of s) {
    const w = isAsciiChar(ch) ? 0.5 : 1;
    if (accW + w + ellW > maxUnits) {
      break;
    }
    acc += ch;
    accW += w;
  }
  if (acc.length === 0) {
    return ell;
  }
  return `${acc}${ell}`;
}

export function splitLocationTwoLines(raw: string, maxUnitsPerLine: number): { line1: string; line2: string } {
  const text = raw.trim() || '-';
  if (maxUnitsPerLine <= 0) {
    return { line1: trimToUnitsWithEllipsis(text, 8), line2: '' };
  }
  if (textWidthUnits(text) <= maxUnitsPerLine) {
    return { line1: text, line2: '' };
  }

  let first = '';
  for (const ch of text) {
    const next = first + ch;
    if (textWidthUnits(next) > maxUnitsPerLine) {
      break;
    }
    first = next;
  }
  if (first.length === 0) {
    first = [...text][0] ?? '';
  }
  let rest = text.slice(first.length).trimStart();
  if (rest.length === 0) {
    return { line1: first, line2: '' };
  }
  if (textWidthUnits(rest) > maxUnitsPerLine) {
    rest = trimToUnitsWithEllipsis(rest, maxUnitsPerLine);
  }
  return { line1: first, line2: rest };
}

/** `formatBorrowedAt` 相当の `MM/DD HH:mm` を `MM/DD・HH:mm` にする。 */
export function formatBorrowedCompactLine(borrowedFormatted: string | null | undefined): string {
  if (!borrowedFormatted?.trim()) {
    return '';
  }
  return borrowedFormatted.trim().replace(/\s+/, '・');
}

export function formatEmployeeCompact(employeeName: string | null | undefined): string {
  if (!employeeName?.trim()) {
    return '未割当';
  }
  return employeeName.trim();
}
