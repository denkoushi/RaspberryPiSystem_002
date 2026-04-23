import { formatLoanInspectionInstrumentLabel } from '../../data-sources/measuring-instrument-loan-inspection/format-loan-inspection-instrument-label.js';
import type { MiBodyLine, MiInstrumentEntry } from './mi-instrument-display.types.js';
import { presentationForInstrumentKind } from './mi-instrument-presentation.js';
import { truncateWithEllipsis } from './instrument-name-text.js';

/** 本文行の安全上限（貸出中が多い場合の二重ループ用） */
export const MAX_BODY_LOGICAL_LINES = 80;

const GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX = 4;

export function computeLineHeightForFont(fontPx: number, scale: number): number {
  return Math.max(Math.round(fontPx * 1.35), Math.round(18 * scale));
}

/**
 * 貸出 0 件カード: 「-」を貸出中と同じ 1.5 倍で表示（現場向け可読性）
 */
export function buildEmptyBodyLines(baseFontPx: number, scale: number): MiBodyLine[] {
  const { bodyFontScale } = presentationForInstrumentKind('active');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  return [{ text: '-', fontSize, lineHeight, tone: 'secondary' }];
}

function interInstrumentGapPx(scale: number): number {
  return Math.round(GAP_BETWEEN_ACTIVE_INSTRUMENTS_YPX * scale);
}

function pushActiveInstrumentLines(
  entry: MiInstrumentEntry,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  out: MiBodyLine[],
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
  entry: MiInstrumentEntry,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  out: MiBodyLine[],
): void {
  const { bodyFontScale } = presentationForInstrumentKind('returned');
  const fontSize = Math.max(1, Math.round(baseFontPx * bodyFontScale));
  const lineHeight = computeLineHeightForFont(fontSize, scale);
  const label = formatLoanInspectionInstrumentLabel(entry.name, entry.managementNumber);
  const text = label.trim() ? truncateWithEllipsis(label.trim(), maxWidthPx, fontSize) : '-';
  out.push({ text, fontSize, lineHeight, tone: 'muted' });
}

/**
 * スペーサ（エントリ間の縦隙間）。描画はスキップし y のみ送る。
 */
function pushSpacer(gapPx: number, out: MiBodyLine[]): void {
  if (gapPx <= 0) {
    return;
  }
  out.push({ text: '', fontSize: 0, lineHeight: gapPx, tone: 'secondary', isSpacer: true });
}

/**
 * 先頭 n 件のエントリから本文行を生成（active は2行/件、returned は1行/件。エントリ間ギャップあり）。
 */
export function buildBodyLinesForEntrySlice(
  entries: readonly MiInstrumentEntry[],
  take: number,
  maxWidthPx: number,
  baseFontPx: number,
  scale: number,
  gapPx: number,
): MiBodyLine[] {
  const slice = entries.slice(0, Math.max(0, take));
  const out: MiBodyLine[] = [];
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

function totalBodyContentHeight(bodyLines: readonly MiBodyLine[]): number {
  return bodyLines.reduce((sum, l) => sum + l.lineHeight, 0);
}

/**
 * 与えた最大高内に収まるよう、エントリ数を減らして再試行する。
 */
export function layoutBodyWithinMaxHeight(params: {
  entries: readonly MiInstrumentEntry[];
  maxWidthPx: number;
  baseFontPx: number;
  scale: number;
  maxHeight: number;
  namesStartY: number;
  bottomPad: number;
}): { bodyLines: MiBodyLine[]; height: number } {
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

  // 1 エントリでも厳しければ、先頭1件を1行に圧縮
  const e = entries[0]!;
  const out: MiBodyLine[] = [];
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
