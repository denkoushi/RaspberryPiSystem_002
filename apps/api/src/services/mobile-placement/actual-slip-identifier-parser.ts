/**
 * 現品票 OCR テキストから製造order（10桁）と製番（FSEIBAN）候補を抽出する純関数。
 * 注文番号（多くは9桁）と製造order（10桁）の取り違えを減らすため、ラベル優先・桁数で弾く。
 */

export type ParsedActualSlipIdentifiers = {
  manufacturingOrder10: string | null;
  fseiban: string | null;
};

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

/**
 * 製造order番号（ProductNo）相当の10桁を抽出する。
 * - 「製造オーダ」「製造order」等のラベル直後を最優先
 * - 「注文番号」行上の数字列は製造orderとして採用しない（9桁主だが10桁誤認にも強くする）
 */
export function extractManufacturingOrder10(text: string): string | null {
  const n = prepareOcrTextForManufacturingOrderExtraction(text);

  const afterLabel = n.match(
    /(?:製造オーダ|製造\s*オーダ|製造order|製造\s*order)[^\d]{0,120}(\d{10})/iu
  );
  if (afterLabel) {
    return afterLabel[1];
  }

  const lines = n.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (/(?:製造オーダ|製造order)/i.test(line)) {
      const m = line.match(/(\d{10})/);
      if (m) return m[1];
    }
  }

  const all10 = [...n.matchAll(/(\d{10})/g)].map((m) => m[1]);
  if (all10.length === 0) {
    return null;
  }

  /** 注文番号ブロック付近の10桁は除外（候補が1件だけのときも誤採用しない） */
  const filtered = all10.filter((digits) => {
    const idx = n.indexOf(digits);
    if (idx < 0) return true;
    const window = n.slice(Math.max(0, idx - 48), Math.min(n.length, idx + digits.length + 48));
    if (/注文番号/.test(window) && !/(?:製造オーダ|製造order)/i.test(window)) {
      return false;
    }
    return true;
  });
  return filtered[0] ?? null;
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
  const manufacturingOrder10 = extractManufacturingOrder10(raw);
  const fseiban = extractFseiban(raw);
  return { manufacturingOrder10, fseiban };
}
