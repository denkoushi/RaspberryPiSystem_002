import { formatLoanInspectionInstrumentLabel } from '../../shared/loan-inspection-card/format-instrument-label.js';
import type { LoanInspectionBodyLine, LoanInspectionInstrumentEntry } from '../../shared/loan-inspection-card/display.types.js';
import {
  buildEmptyBodyLines,
  computeLineHeightForFont,
  MAX_BODY_LOGICAL_LINES,
  type LayoutBodyWithinMaxHeightParams,
  type LayoutBodyWithinMaxHeightResult,
} from '../../shared/loan-inspection-card/layout-body.js';
import { presentationForInstrumentKind } from '../../shared/loan-inspection-card/instrument-presentation.js';
import { truncateWithEllipsis } from '../../shared/loan-inspection-card/instrument-name-text.js';

const GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX = 4;

function interInstrumentGapPx(scale: number): number {
  return Math.round(GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX * scale);
}

function pushCombinedActiveInstrumentLines(
  entries: readonly LoanInspectionInstrumentEntry[],
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  out: LoanInspectionBodyLine[],
): void {
  const { bodyFontScale } = presentationForInstrumentKind('active');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  const mgmts = entries.map((entry) => entry.managementNumber.trim()).filter(Boolean);
  const names = [...new Set(entries.map((entry) => entry.name.trim()).filter(Boolean))];
  const mgmtLine =
    mgmts.length > 0
      ? truncateWithEllipsis(mgmts.join(' ・ '), maxWidthPx, fontSize)
      : truncateWithEllipsis('—', maxWidthPx, fontSize);
  const nameLine =
    names.length === 1
      ? truncateWithEllipsis(names[0]!, maxWidthPx, fontSize)
      : names.length > 1
        ? truncateWithEllipsis(names.join(' ・ '), maxWidthPx, fontSize)
        : truncateWithEllipsis('—', maxWidthPx, fontSize);
  out.push(
    { text: mgmtLine, fontSize, lineHeight, tone: 'primary' },
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

function buildRiggingBodyLinesForEntrySlice(
  entries: readonly LoanInspectionInstrumentEntry[],
  take: number,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  gapPx: number,
): LoanInspectionBodyLine[] {
  const slice = entries.slice(0, Math.max(0, take));
  const out: LoanInspectionBodyLine[] = [];
  let i = 0;
  let isFirstBlock = true;
  while (i < slice.length) {
    if (!isFirstBlock) {
      pushSpacer(gapPx, out);
    }
    isFirstBlock = false;

    const entry = slice[i]!;
    if (entry.kind === 'returned') {
      pushReturnedInstrumentLine(entry, maxWidthPx, baseFontPx, scale, out);
      i += 1;
      continue;
    }

    const activeGroup: LoanInspectionInstrumentEntry[] = [];
    while (i < slice.length && slice[i]!.kind === 'active') {
      activeGroup.push(slice[i]!);
      i += 1;
    }
    if (activeGroup.length >= 1) {
      pushCombinedActiveInstrumentLines(activeGroup, maxWidthPx, baseFontPx, scale, out);
    }
  }
  return out;
}

function totalBodyContentHeight(bodyLines: readonly LoanInspectionBodyLine[]): number {
  return bodyLines.reduce((sum, l) => sum + l.lineHeight, 0);
}

/** 吊具点検サイネージ専用: active 管理番号を ` ・ ` で1行にまとめる。 */
export function layoutRiggingBodyWithinMaxHeight(
  params: LayoutBodyWithinMaxHeightParams,
): LayoutBodyWithinMaxHeightResult {
  const { entries, maxWidthPx, baseFontPx, scale, maxHeight, namesStartY, bottomPad } = params;
  const gapPx = interInstrumentGapPx(scale);
  if (entries.length === 0) {
    const lines = buildEmptyBodyLines(baseFontPx, scale);
    const h = namesStartY + totalBodyContentHeight(lines) + bottomPad;
    return { bodyLines: lines, height: h };
  }

  for (let take = entries.length; take >= 1; take -= 1) {
    const bodyLines = buildRiggingBodyLinesForEntrySlice(entries, take, maxWidthPx, baseFontPx, scale, gapPx);
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
    pushCombinedActiveInstrumentLines([e], maxWidthPx, baseFontPx, scale, out);
  }
  return {
    bodyLines: out,
    height: namesStartY + totalBodyContentHeight(out) + bottomPad,
  };
}
