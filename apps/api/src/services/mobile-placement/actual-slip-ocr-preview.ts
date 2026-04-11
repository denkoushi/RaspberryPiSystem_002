const OCR_PREVIEW_MAX = 120;

/**
 * 数字・英数字 OCR のみを結合したプレビュー用文字列（日本語ラベル由来のノイズを抑止）。
 * UI 表示用。API 応答の `ocrPreviewSafe` に使用。
 */
export function buildActualSlipOcrPreviewSafe(digitsText: string, auxText: string): string | null {
  const d = digitsText.trim();
  const a = auxText.trim();
  if (!d && !a) return null;
  const base = d === a ? d : [d, a].filter(Boolean).join(' ');
  const t = base.replace(/\s+/g, ' ').trim();
  if (t.length <= OCR_PREVIEW_MAX) return t;
  return `${t.slice(0, OCR_PREVIEW_MAX)}…`;
}
