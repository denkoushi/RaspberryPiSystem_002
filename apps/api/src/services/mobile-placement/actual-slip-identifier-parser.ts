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
  /(?:製\s*造\s*(?:オ\s*ー\s*ダ|オーダ)|製\s*造\s*order)[^\d]{0,120}(\d{10})/iu;

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

/**
 * 製造order番号（ProductNo）相当の10桁を抽出する（診断付き）。
 * - 「製造オーダ」「製造 オー ダ」「製造order」等のラベル直後を最優先（分断ノイズ許容）
 * - 「注文番号」行上の数字列は製造orderとして採用しない（9桁主だが10桁誤認にも強くする）
 */
export function parseManufacturingOrder10Extraction(text: string): {
  value: string | null;
  diagnostics: ManufacturingOrder10ParseDiagnostics;
} {
  const n = prepareOcrTextForManufacturingOrderExtraction(text);
  const all10Matches = [...n.matchAll(/(\d{10})/g)];
  const candidate10Count = all10Matches.length;

  const afterLabel = n.match(TEN_DIGITS_AFTER_MANUFACTURING_ORDER_LABEL);
  if (afterLabel) {
    return {
      value: afterLabel[1],
      diagnostics: {
        candidate10Count,
        afterOrderBlockFilterCount: 0,
        source: 'label-regex'
      }
    };
  }

  const lines = n.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (MANUFACTURING_ORDER_LABEL.test(line)) {
      const m = line.match(/(\d{10})/);
      if (m) {
        return {
          value: m[1],
          diagnostics: {
            candidate10Count,
            afterOrderBlockFilterCount: 0,
            source: 'line-scan'
          }
        };
      }
    }
  }

  const all10 = all10Matches.map((m) => m[1]);
  if (all10.length === 0) {
    return {
      value: null,
      diagnostics: {
        candidate10Count: 0,
        afterOrderBlockFilterCount: 0,
        source: 'none'
      }
    };
  }

  /** 注文番号ブロック付近の10桁は除外（候補が1件だけのときも誤採用しない）。製造ラベルは分断許容パターンで検出 */
  const filtered = all10.filter((digits) => {
    const idx = n.indexOf(digits);
    if (idx < 0) return true;
    const window = n.slice(Math.max(0, idx - 48), Math.min(n.length, idx + digits.length + 48));
    if (/注文番号/.test(window) && !MANUFACTURING_ORDER_LABEL.test(window)) {
      return false;
    }
    return true;
  });

  return {
    value: filtered[0] ?? null,
    diagnostics: {
      candidate10Count,
      afterOrderBlockFilterCount: filtered.length,
      source: filtered.length > 0 ? 'global-filter' : 'none'
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
