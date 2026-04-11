/**
 * 現品票画像 OCR の結果表示（UI 用。API 契約とは独立）
 */
export type ActualSlipOcrStatus = 'idle' | 'success' | 'no_candidate' | 'error';

export type ActualSlipOcrFeedback = {
  status: ActualSlipOcrStatus;
  manufacturingOrder10: string | null;
  fseiban: string | null;
  /** OCR 本文の先頭のみ（確認用。長文は切り詰め） */
  ocrPreview: string | null;
  /** ユーザー向け短文 */
  message: string | null;
  /** 例外時の技術メッセージ（短く） */
  errorDetail: string | null;
};

export const initialActualSlipOcrFeedback: ActualSlipOcrFeedback = {
  status: 'idle',
  manufacturingOrder10: null,
  fseiban: null,
  ocrPreview: null,
  message: null,
  errorDetail: null
};

const OCR_PREVIEW_MAX = 120;

/**
 * @param ocrText API の `ocrPreviewSafe`（推奨）または結合 `ocrText`
 */
export function buildOcrPreview(ocrText: string | undefined | null): string | null {
  if (ocrText == null || ocrText.trim().length === 0) return null;
  const t = ocrText.replace(/\s+/g, ' ').trim();
  if (t.length <= OCR_PREVIEW_MAX) return t;
  return `${t.slice(0, OCR_PREVIEW_MAX)}…`;
}
