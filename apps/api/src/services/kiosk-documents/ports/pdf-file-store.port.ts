/**
 * PDFバイナリの保存ポート（既存 PdfStorage へのアダプタ差し替え用）
 */
export interface PdfFileStorePort {
  savePdf(originalFilename: string, buffer: Buffer): Promise<{
    id: string;
    filename: string;
    filePath: string;
    relativePath: string;
  }>;
  deletePdfByStorageUrl(pdfUrl: string): Promise<void>;
}
