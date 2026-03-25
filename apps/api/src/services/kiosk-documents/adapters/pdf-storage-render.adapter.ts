import { PdfStorage } from '../../../lib/pdf-storage.js';
import type { PdfRenderPort } from '../ports/pdf-render.port.js';

export class PdfStorageRenderAdapter implements PdfRenderPort {
  async convertPdfToPageUrls(documentId: string, pdfFilePath: string): Promise<string[]> {
    return PdfStorage.convertPdfToPages(documentId, pdfFilePath);
  }

  async deletePageImages(documentId: string): Promise<void> {
    await PdfStorage.deletePdfPages(documentId);
  }
}
