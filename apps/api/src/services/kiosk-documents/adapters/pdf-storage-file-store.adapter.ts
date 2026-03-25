import { PdfStorage } from '../../../lib/pdf-storage.js';
import type { PdfFileStorePort } from '../ports/pdf-file-store.port.js';

export class PdfStorageFileStoreAdapter implements PdfFileStorePort {
  async savePdf(originalFilename: string, buffer: Buffer) {
    return PdfStorage.savePdf(originalFilename, buffer);
  }

  async deletePdfByStorageUrl(pdfUrl: string): Promise<void> {
    await PdfStorage.deletePdf(pdfUrl);
  }
}
