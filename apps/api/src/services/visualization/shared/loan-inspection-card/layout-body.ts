import { formatLoanInspectionInstrumentLabel } from './format-instrument-label.js';
import type { LoanInspectionBodyLine, LoanInspectionInstrumentEntry } from './display.types.js';
import { presentationForInstrumentKind } from './instrument-presentation.js';
import { truncateWithEllipsis } from './instrument-name-text.js';

export const MAX_BODY_LOGICAL_LINES = 80;

const GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX = 4;

export function computeLineHeightForFont(fontPx: number, scale: number): number {
  return Math.max(Math.round(fontPx * 1.35), Math.round(18 * scale));
}

export function buildEmptyBodyLines(baseFontPx: number, scale: number): LoanInspectionBodyLine[] {
  const { bodyFontScale } = presentationForInstrumentKind('active');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  return [{ text: '-', fontSize, lineHeight, tone: 'secondary' }];
}

function interInstrumentGapPx(scale: number): number {
  return Math.round(GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX * scale);
}

function pushActiveInstrumentLines(
  entry: LoanInspectionInstrumentEntry,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  out: LoanInspectionBodyLine[],
): void {
  const { bodyFontScale } = presentationForInstrumentKind('active');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  const mgmt = entry.managementNumber.trim();
  const name = entry.name.trim();
  const mgmtLine = mgmt
    ? truncateWithEllipsis(mgmt, maxWidthPx, fontSize)
    : truncateWithEllipsis('—', maxWidthPx, fontSize);
  const nameLine = name
    ? truncateWithEllipsis(name, maxWidthPx, fontSize)
    : truncateWithEllipsis('—', maxWidthPx, fontSize);
  out.push(
    { text: mgmtLine, fontSize, lineHeight, tone: 'secondary' },
    { text: nameLine, fontSize, lineHeight, tone: 'secondary' },
  );
}

function pushReturnedInstrumentLine(
  entry: LoanInspectionInstrumentEntry,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  out: LoanInspectionBodyLine[],
): void {
  const { bodyFontScale } = presentationForInstrumentKind('returned');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  const label = formatLoanInspectionInstrumentLabel(entry.name, entry.managementNumber);
  const text = label.trim() ? truncateWithEllipsis(label.trim(), maxWidthPx, fontSize) : '-';
  out.push({ text, fontSize, lineHeight, tone: 'muted' });
}

function pushSpacer(gapPx: number, out: LoanInspectionBodyLine[]): void {
  if (gapPx <= 0) {
    return;
  }
  out.push({ text: '', fontSize: 0, lineHeight: gapPx, tone: 'secondary', isSpacer: true });
}

export function buildBodyLinesForEntrySlice(
  entries: readonly LoanInspectionInstrumentEntry[],
  take: number,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  gapPx: number,
): LoanInspectionBodyLine[] {
  const slice = entries.slice(0, Math.max(0, take));
  const out: LoanInspectionBodyLine[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    if (i > 0) {
      pushSpacer(gapPx, out);
    }
    const e = slice[i]!;
    if (e.kind === 'returned') {
      pushReturnedInstrumentLine(e, maxWidthPx, baseFontPx, scale, out);
    } else {
      pushActiveInstrumentLines(e, maxWidthPx, baseFontPx, scale, out);
    }
  }
  return out;
}

function totalBodyContentHeight(bodyLines: readonly LoanInspectionBodyLine[]): number {
  return bodyLines.reduce((sum, l) => sum + l.lineHeight, 0);
}

export function layoutBodyWithinMaxHeight(params: {
  entries: readonly LoanInspectionInstrumentEntry[];
  maxWidthPx: number;
  baseFontPx: number;
  scale: number;
  maxHeight: number;
  namesStartY: number;
  bottomPad: number;
}): { bodyLines: LoanInspectionBodyLine[]; height: number } {
  const { entries, maxWidthPx, baseFontPx, scale, maxHeight, namesStartY, bottomPad } = params;
  const gapPx = interInstrumentGapPx(scale);
  if (entries.length === 0) {
    const lines = buildEmptyBodyLines(baseFontPx, scale);
    const h = namesStartY + totalBodyContentHeight(lines) + bottomPad;
    return { bodyLines: lines, height: h };
  }

  for (let take = entries.length; take >= 1; take -= 1) {
    const bodyLines = buildBodyLinesForEntrySlice(entries, take, maxWidthPx, baseFontPx, scale, gapPx);
    if (bodyLines.length > MAX_BODY_LOGICAL_LINES) {
      continue;
    }
    const h = namesStartY + totalBodyContentHeight(bodyLines) + bottomPad;
    if (h <= maxHeight) {
      return { bodyLines, height: h };
    }
  }

  const e = entries[0]!;
  const out: LoanInspectionBodyLine[] = [];
  if (e.kind === 'returned') {
    pushReturnedInstrumentLine(e, maxWidthPx, baseFontPx, scale, out);
  } else {
    const { bodyFontScale } = presentationForInstrumentKind('active');
    const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
    const lineHeight = computeLineHeightForFont(fontSize, scale);
    const full = [e.managementNumber.trim(), e.name.trim()].filter(Boolean).join(' ');
    const t = full ? truncateWithEllipsis(full, maxWidthPx, fontSize) : '-';
    out.push({ text: t, fontSize, lineHeight, tone: 'secondary' });
  }
  return {
    bodyLines: out,
    height: namesStartY + totalBodyContentHeight(out) + bottomPad,
  };
}
