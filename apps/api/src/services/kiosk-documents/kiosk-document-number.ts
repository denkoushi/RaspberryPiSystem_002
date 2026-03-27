/**
 * ISO 風の要領書番号（例: 産1-G025AAK）。
 * 先頭1文字は漢字、続けて数字、ハイフン、大文字英数字。
 */
export const KIOSK_DOCUMENT_NUMBER_PATTERN = /^[\u4e00-\u9fff][0-9]+-[A-Z0-9]+$/u;

/** 本文走査用（行頭終端なし） */
const DOCUMENT_NUMBER_IN_TEXT_PATTERN = /[\u4e00-\u9fff][0-9]+-[A-Z0-9]+/gu;

export function isValidKioskDocumentNumber(value: string): boolean {
  const t = value.trim();
  return t.length > 0 && t.length <= 64 && KIOSK_DOCUMENT_NUMBER_PATTERN.test(t);
}

/**
 * OCR 本文から最初に一致する文書番号候補を返す（重複・部分一致を避けて全体マッチのみ）
 */
export function extractDocumentNumberCandidate(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ');
  const matches = normalized.match(DOCUMENT_NUMBER_IN_TEXT_PATTERN);
  if (!matches?.length) {
    return undefined;
  }
  const first = matches[0];
  return KIOSK_DOCUMENT_NUMBER_PATTERN.test(first) ? first : undefined;
}

export function documentNumberConfidence(found: boolean): number {
  return found ? 0.85 : 0.1;
}
