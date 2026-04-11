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
 * 製造order番号（ProductNo）相当の10桁を抽出する。
 * - 「製造オーダ」「製造order」等のラベル直後を最優先
 * - 「注文番号」行上の数字列は製造orderとして採用しない（9桁主だが10桁誤認にも強くする）
 */
export function extractManufacturingOrder10(text: string): string | null {
  const n = normalizeDigitsFullWidthToHalfWidth(text);

  const afterLabel = n.match(
    /(?:製造オーダ|製造\s*オーダ|製造order|製造\s*order)[^\d]{0,32}(\d{10})/iu
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
  if (all10.length === 1) {
    return all10[0];
  }

  /** 注文番号ブロック付近の10桁は除外 */
  const filtered = all10.filter((digits) => {
    const idx = n.indexOf(digits);
    if (idx < 0) return true;
    const window = n.slice(Math.max(0, idx - 48), Math.min(n.length, idx + digits.length + 48));
    if (/注文番号/.test(window) && !/(?:製造オーダ|製造order)/i.test(window)) {
      return false;
    }
    return true;
  });
  return filtered[0] ?? all10[0];
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
