/**
 * OCR 正規化済み本文から要約テキストを推論する（任意・補助）。
 * 失敗時は null を返し、呼び出し側が機械スニペットへフォールバックする。
 */
export interface DocumentSummaryInferencePort {
  trySummarize(normalizedText: string): Promise<string | null>;
}
