/**
 * 現品票 OCR テキストから製造order（10桁）と製番（FSEIBAN）候補を抽出する純関数。
 * 注文番号（多くは9桁）と製造order（10桁）の取り違えを減らすため、ラベル優先・桁数で弾く。
 */

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

/** 注文番号ラベル（OCRで「注文 番号」のように分断され得る） */
const ORDER_NUMBER_LABEL = /注\s*文\s*番\s*号/iu;

/** 枝番ラベル（OCRで「枝 番」のように分断され得る） */
const EDABAN_LABEL = /枝\s*番/iu;

/** 全角数字を半角へ */
export function normalizeDigitsFullWidthToHalfWidth(s: string): string {
  return s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
}

/**
 * OCR で桁の途中に空白・改行が混入した場合に連結する（注文番号ブロック判定の前処理）
 */
export function collapseInterDigitWhitespace(s: string): string {
  return s.replace(/(?<=\d)[\s\u3000]+(?=\d)/g, '');
}

/**
 * 連続する数字列内で出やすい OCR 誤認のみ補正（英字ラベルは触らない）
 * `0002178OO5` のように O が連続する場合も、数回適用で `0002178005` へ寄せる。
 */
export function fixAdjacentOcrDigitConfusion(s: string): string {
  let out = s;
  for (let i = 0; i < 14; i++) {
    const next = out
      .replace(/(?<=\d)[Oo](?=[0-9Oo])/g, '0')
      .replace(/(?<=\d)[Il|](?=[0-9Il|])/g, '1');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 10桁候補トークン内の OCR 誤認（O/I/l/|）を数字へ補正 */
function normalizeLooseDigitToken(token: string): string {
  return token.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
}

/**
 * 製造order抽出用に OCR テキストを正規化する（純関数・parser 内に閉じる）
 */
export function prepareOcrTextForManufacturingOrderExtraction(text: string): string {
  let n = normalizeDigitsFullWidthToHalfWidth(text);
  n = collapseInterDigitWhitespace(n);
  n = fixAdjacentOcrDigitConfusion(n);
  return n;
}

export type ManufacturingOrder10ParseSource = 'label-regex' | 'line-scan' | 'global-filter' | 'none';

export type ManufacturingOrder10ParseDiagnostics = {
  /** 正規化後テキスト内の 10 桁連続（重複あり得る）の件数 */
  candidate10Count: number;
  /** 注文番号近傍除外後に残った候補の件数（global-filter 経路のみ意味あり） */
  afterOrderBlockFilterCount: number;
  source: ManufacturingOrder10ParseSource;
};

/** 同一行に「注文番号」と「枝番」が両方ある行の直後インデックス（該当なしは -1） */
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

/** 桁候補が属する行の [start, end) */
function digitLineBounds(n: string, digitStart: number): { lineStart: number; lineEnd: number } {
  const lineStart = n.lastIndexOf('\n', digitStart - 1) + 1;
  const nl = n.indexOf('\n', digitStart);
  const lineEnd = nl === -1 ? n.length : nl;
  return { lineStart, lineEnd };
}

/** 10桁が「注文番号＋枝番」行上に完全に含まれるか（その行の数字は製造orderにしない） */
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

/**
 * 同一行に注文番号があり製造ラベルが無い場合はその行の10桁を除外（前行の注文番号では除外しない）
 */
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

/** global-filter 用: 注文行・注文のみ行の除外ルール（診断件数と選別で同一ロジックを使う） */
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

/**
 * global-filter 経路: 候補を除外したうえで、先頭ではなく文脈スコアで1件選ぶ。
 */
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
 * - 「製造オーダ」「製造 オー ダ」「製造order」等のラベル直後を最優先（分断ノイズ許容）
 * - 「注文番号」行（同一行に「枝番」がある現品票形式）上の数字は製造orderとして採用しない
 * - フォールバックは先頭10桁ではなく、除外後の候補を文脈で選別する
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

/**
 * 製造order番号（ProductNo）相当の10桁を抽出する。
 * - 「製造オーダ」「製造order」等のラベル直後を最優先
 * - 「注文番号」行上の数字列は製造orderとして採用しない（9桁主だが10桁誤認にも強くする）
 */
export function extractManufacturingOrder10(text: string): string | null {
  return parseManufacturingOrder10Extraction(text).value;
}

/**
 * 製番（FSEIBAN）候補。ラベル「製番」優先、無ければ英字始まりのトークンを緩く拾う。
 */
export function extractFseiban(text: string): string | null {
  const n = normalizeDigitsFullWidthToHalfWidth(text).replace(/\u3000/g, ' ');

  const labeled = n.match(/(?:製番|製\s*番)\s*[:：]?\s*([A-Za-z0-9]{6,14})/u);
  if (labeled) {
    return labeled[1].toUpperCase();
  }

  const loose = n.match(/\b([A-Z][A-Z0-9]{5,11})\b/);
  if (loose) {
    return loose[1].toUpperCase();
  }
  return null;
}

export function parseActualSlipIdentifiersFromOcrText(raw: string): ParsedActualSlipIdentifiers {
  const manufacturingOrder10 = parseManufacturingOrder10Extraction(raw).value;
  const fseiban = extractFseiban(raw);
  return { manufacturingOrder10, fseiban };
}
