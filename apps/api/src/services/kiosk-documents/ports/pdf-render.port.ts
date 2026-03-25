/**
 * PDFページ画像化ポート（既存 PdfStorage.convertPdfToPages へのアダプタ用）
 */
export interface PdfRenderPort {
  convertPdfToPageUrls(documentId: string, pdfFilePath: string): Promise<string[]>;
  deletePageImages(documentId: string): Promise<void>;
}
