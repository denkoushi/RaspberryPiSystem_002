import { PdfStorage } from '../../../lib/pdf-storage.js';
import type { PdfRenderPort } from '../ports/pdf-render.port.js';

/** 未設定時の既定（サイネージより軽め。Pi4 キオスク閲覧向け） */
const DEFAULT_KIOSK_DOCUMENT_PDF_DPI = 120;
const DEFAULT_KIOSK_DOCUMENT_JPEG_QUALITY = 78;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * キオスク要領書用の PDF→JPEG 変換パラメータ（環境変数で上書き可）。
 * 画質・解像度は `KIOSK_DOCUMENT_PDF_DPI` / `KIOSK_DOCUMENT_JPEG_QUALITY` で現場調整する（コード既定の変更は読みやすさに直結するため慎重に）。
 */
export function resolveKioskDocumentPdfRenderOptions(): { dpi: number; quality: number } {
  return {
    dpi: parsePositiveInt(process.env.KIOSK_DOCUMENT_PDF_DPI, DEFAULT_KIOSK_DOCUMENT_PDF_DPI),
    quality: parsePositiveInt(process.env.KIOSK_DOCUMENT_JPEG_QUALITY, DEFAULT_KIOSK_DOCUMENT_JPEG_QUALITY),
  };
}

export class PdfStorageRenderAdapter implements PdfRenderPort {
  async convertPdfToPageUrls(documentId: string, pdfFilePath: string): Promise<string[]> {
    const { dpi, quality } = resolveKioskDocumentPdfRenderOptions();
    return PdfStorage.convertPdfToPages(documentId, pdfFilePath, { dpi, quality });
  }

  async deletePageImages(documentId: string): Promise<void> {
    await PdfStorage.deletePdfPages(documentId);
  }
}
