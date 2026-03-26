export type ExtractedDocumentText = {
  text: string;
  pageCount?: number;
};

/**
 * 文字埋め込み PDF などから本文を抽出するポート
 */
export interface DocumentTextExtractorPort {
  extractText(pdfPath: string): Promise<ExtractedDocumentText>;
}
