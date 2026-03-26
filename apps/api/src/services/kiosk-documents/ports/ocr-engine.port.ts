export type OcrResult = {
  text: string;
  pageCount?: number;
  engine: string;
};

/**
 * OCR 実行ポート（将来のエンジン差し替えの境界）
 */
export interface OcrEnginePort {
  runOcr(pdfPath: string): Promise<OcrResult>;
}
