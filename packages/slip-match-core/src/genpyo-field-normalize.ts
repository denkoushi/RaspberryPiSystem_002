/**
 * 現品票フィールド抽出用の OCR テキスト正規化（純関数）。
 * 製造order・FSEIBAN 双方で共有する。
 */

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
 * 製造order抽出用に OCR テキストを正規化する
 */
export function prepareOcrTextForManufacturingOrderExtraction(text: string): string {
  let n = normalizeDigitsFullWidthToHalfWidth(text);
  n = collapseInterDigitWhitespace(n);
  n = fixAdjacentOcrDigitConfusion(n);
  return n;
}
