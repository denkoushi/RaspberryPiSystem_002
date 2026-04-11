export type OcrResult = {
  text: string;
  pageCount?: number;
  engine: string;
};

/**
 * OCR 実行ポート（エンジン差し替えの境界）。
 * 要領書以外の用途でも再利用できるよう、中立な契約とする。
 */
export interface OcrEnginePort {
  runOcr(pdfPath: string): Promise<OcrResult>;
}
