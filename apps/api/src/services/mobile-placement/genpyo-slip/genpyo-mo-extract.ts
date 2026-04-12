/**
 * 製造order（10桁）抽出。ROI 単位の短いテキストでも、スタブが全文を返す場合も同じロジックで扱う。
 */

import { prepareOcrTextForManufacturingOrderExtraction } from './genpyo-field-normalize.js';

export type ParsedActualSlipIdentifiers = {
  manufacturingOrder10: string | null;
  fseiban: string | null;
};

/** 製造orderラベル（OCRで「製造 オー ダ」のように分断され得る） */
const MANUFACTURING_ORDER_LABEL =
  /(?:製\s*造\s*(?:オ\s*ー\s*ダ|オーダ)|製\s*造\s*order)/iu;

/** ラベル直後〜120非数字以内の10桁（製造order本体） */
const TEN_DIGITS_AFTER_MANUFACTURING_ORDER_LABEL =
  /(?:製\s*造\s*(?:オ\s*ー\s*ダ|オーダ)|製\s*造\s*order)[^\d]{0,120}([0-9OoIl|]{10})/iu;

/** 注文番号ラベル */
const ORDER_NUMBER_LABEL = /注\s*文\s*番\s*号/iu;

/** 枝番ラベル */
const EDABAN_LABEL = /枝\s*番/iu;

/** 10桁候補トークン内の OCR 誤認（O/I/l/|）を数字へ補正 */
function normalizeLooseDigitToken(token: string): string {
  return token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
}

export type ManufacturingOrder10ParseSource = 'label-regex' | 'line-scan' | 'global-filter' | 'none';

export type ManufacturingOrder10ParseDiagnostics = {
  candidate10Count: number;
  afterOrderBlockFilterCount: number;
  source: ManufacturingOrder10ParseSource;
};

function findLastOrderLineWithEdabanAfterIndex(n: string): number {
  let best = -1;
  let pos = 0;
  for (;;) {
    const nl = n.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n.length : nl;
    const line = n.slice(pos, lineEnd);
    if (ORDER_NUMBER_LABEL.test(line) && EDABAN_LABEL.test(line)) {
      const afterLine = nl === -1 ? n.length : nl + 1;
      best = Math.max(best, afterLine);
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return best;
}

function digitLineBounds(n: string, digitStart: number): { lineStart: number; lineEnd: number } {
  const lineStart = n.lastIndexOf('\n', digitStart - 1) + 1;
  const nl = n.indexOf('\n', digitStart);
  const lineEnd = nl === -1 ? n.length : nl;
  return { lineStart, lineEnd };
}

function isTenDigitOnOrderLineWithEdaban(n: string, digitStart: number, digitEnd: number): boolean {
  let pos = 0;
  for (;;) {
    const nl = n.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n.length : nl;
    const lineStart = pos;
    const line = n.slice(lineStart, lineEnd);
    if (ORDER_NUMBER_LABEL.test(line) && EDABAN_LABEL.test(line)) {
      if (digitStart >= lineStart && digitEnd <= lineEnd) {
        return true;
      }
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return false;
}

function isTenDigitOnOrderOnlyLineWithoutManufacturingLabel(n: string, digitStart: number): boolean {
  const { lineStart, lineEnd } = digitLineBounds(n, digitStart);
  const line = n.slice(lineStart, lineEnd);
  return ORDER_NUMBER_LABEL.test(line) && !MANUFACTURING_ORDER_LABEL.test(line);
}

type TenDigitMatch = { digits: string; idx: number };

function collectTenDigitMatches(n: string): TenDigitMatch[] {
  const out: TenDigitMatch[] = [];
  for (const m of n.matchAll(/(\d{10})/g)) {
    if (m.index !== undefined) {
      out.push({ digits: m[1], idx: m.index });
    }
  }
  return out;
}

function filterEligibleGlobalMatches(n: string, matches: TenDigitMatch[]): TenDigitMatch[] {
  return matches.filter((m) => {
    const digitEnd = m.idx + 10;
    if (isTenDigitOnOrderLineWithEdaban(n, m.idx, digitEnd)) {
      return false;
    }
    if (isTenDigitOnOrderOnlyLineWithoutManufacturingLabel(n, m.idx)) {
      return false;
    }
    return true;
  });
}

function pickBestGlobalFilterCandidate(n: string, matches: TenDigitMatch[]): string | null {
  const filtered = filterEligibleGlobalMatches(n, matches);

  if (filtered.length === 0) {
    return null;
  }

  const afterOrderIdx = findLastOrderLineWithEdabanAfterIndex(n);

  const scoreWindow = (idx: number): number => {
    const lo = Math.max(0, idx - 120);
    const hi = Math.min(n.length, idx + 10);
    const win = n.slice(lo, hi);
    let s = 0;
    if (MANUFACTURING_ORDER_LABEL.test(win)) s += 100;
    if (/No\s*[:：]?/iu.test(win)) s += 40;
    if (/オ\s*ー\s*ダ|オーダ|order/iu.test(win)) s += 20;
    return s;
  };

  filtered.sort((a, b) => {
    const aAfter = afterOrderIdx >= 0 && a.idx >= afterOrderIdx;
    const bAfter = afterOrderIdx >= 0 && b.idx >= afterOrderIdx;
    if (aAfter !== bAfter) {
      return aAfter ? -1 : 1;
    }
    const sa = scoreWindow(a.idx);
    const sb = scoreWindow(b.idx);
    if (sb !== sa) {
      return sb - sa;
    }
    return a.idx - b.idx;
  });

  return filtered[0].digits;
}

/**
 * 製造order番号（ProductNo）相当の10桁を抽出する（診断付き）。
 */
export function parseManufacturingOrder10Extraction(text: string): {
  value: string | null;
  diagnostics: ManufacturingOrder10ParseDiagnostics;
} {
  const n = prepareOcrTextForManufacturingOrderExtraction(text);
  const all10Matches = collectTenDigitMatches(n);
  const candidate10Count = all10Matches.length;

  const afterLabel = n.match(TEN_DIGITS_AFTER_MANUFACTURING_ORDER_LABEL);
  if (afterLabel) {
    const normalizedAfterLabel = normalizeLooseDigitToken(afterLabel[1]);
    if (/^\d{10}$/.test(normalizedAfterLabel)) {
      return {
        value: normalizedAfterLabel,
        diagnostics: {
          candidate10Count,
          afterOrderBlockFilterCount: 0,
          source: 'label-regex'
        }
      };
    }
  }

  const lines = n.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (MANUFACTURING_ORDER_LABEL.test(line)) {
      const m = line.match(/([0-9OoIl|]{10})/);
      if (m) {
        const normalizedLineToken = normalizeLooseDigitToken(m[1]);
        if (/^\d{10}$/.test(normalizedLineToken)) {
          return {
            value: normalizedLineToken,
            diagnostics: {
              candidate10Count,
              afterOrderBlockFilterCount: 0,
              source: 'line-scan'
            }
          };
        }
      }
    }
  }

  if (all10Matches.length === 0) {
    return {
      value: null,
      diagnostics: {
        candidate10Count: 0,
        afterOrderBlockFilterCount: 0,
        source: 'none'
      }
    };
  }

  const picked = pickBestGlobalFilterCandidate(n, all10Matches);
  const filteredCount = filterEligibleGlobalMatches(n, all10Matches).length;

  return {
    value: picked,
    diagnostics: {
      candidate10Count,
      afterOrderBlockFilterCount: filteredCount,
      source: picked != null ? 'global-filter' : 'none'
    }
  };
}

export function extractManufacturingOrder10(text: string): string | null {
  return parseManufacturingOrder10Extraction(text).value;
}
