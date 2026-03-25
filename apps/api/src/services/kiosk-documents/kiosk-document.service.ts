import { createHash } from 'crypto';
import path from 'path';

import type { KioskDocument } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import type { KioskDocumentListFilters, KioskDocumentRepositoryPort } from './ports/kiosk-document-repository.port.js';
import type { PdfFileStorePort } from './ports/pdf-file-store.port.js';
import type { PdfRenderPort } from './ports/pdf-render.port.js';

export type KioskDocumentDetail = {
  document: KioskDocument;
  pageUrls: string[];
};

export function buildGmailDedupeKey(messageId: string, attachmentFilename: string): string {
  return createHash('sha256').update(`${messageId}|${attachmentFilename}`, 'utf8').digest('hex');
}

/**
 * キオスク要領書のユースケース（保存・一覧・表示用メタデータ）
 */
export class KioskDocumentService {
  constructor(
    private readonly repo: KioskDocumentRepositoryPort,
    private readonly fileStore: PdfFileStorePort,
    private readonly render: PdfRenderPort
  ) {}

  async createManualUpload(params: {
    buffer: Buffer;
    originalFilename: string;
    title?: string;
  }): Promise<KioskDocumentDetail> {
    const originalFilename = params.originalFilename.trim() || 'document.pdf';
    if (!originalFilename.toLowerCase().endsWith('.pdf')) {
      throw new ApiError(400, 'PDFファイルのみアップロードできます', undefined, 'KIOSK_DOC_NOT_PDF');
    }
    const pathInfo = await this.fileStore.savePdf(originalFilename, params.buffer);
    const title =
      params.title?.trim() ||
      originalFilename.replace(/\.pdf$/i, '') ||
      'document';
    const doc = await this.repo.create({
      title,
      filename: pathInfo.filename,
      filePath: pathInfo.filePath,
      sourceType: 'MANUAL',
      sourceAttachmentName: originalFilename,
    });
    const pageUrls = await this.render.convertPdfToPageUrls(doc.id, pathInfo.filePath);
    const updated = await this.repo.update(doc.id, { pageCount: pageUrls.length });
    return { document: updated, pageUrls };
  }

  async createFromGmailAttachment(params: {
    buffer: Buffer;
    attachmentFilename: string;
    gmailMessageId: string;
  }): Promise<KioskDocumentDetail | null> {
    const attachmentFilename = params.attachmentFilename.trim() || 'document.pdf';
    const gmailDedupeKey = buildGmailDedupeKey(params.gmailMessageId, attachmentFilename);
    const existing = await this.repo.findByGmailDedupeKey(gmailDedupeKey);
    if (existing) {
      return null;
    }
    const pathInfo = await this.fileStore.savePdf(attachmentFilename, params.buffer);
    const title = attachmentFilename.replace(/\.pdf$/i, '') || 'document';
    const doc = await this.repo.create({
      title,
      filename: pathInfo.filename,
      filePath: pathInfo.filePath,
      sourceType: 'GMAIL',
      gmailMessageId: params.gmailMessageId,
      sourceAttachmentName: attachmentFilename,
      gmailDedupeKey,
    });
    const pageUrls = await this.render.convertPdfToPageUrls(doc.id, pathInfo.filePath);
    const updated = await this.repo.update(doc.id, { pageCount: pageUrls.length });
    return { document: updated, pageUrls };
  }

  async listForKiosk(filters: KioskDocumentListFilters): Promise<KioskDocument[]> {
    return this.repo.list({ ...filters, enabledOnly: true });
  }

  async listForAdmin(filters: KioskDocumentListFilters): Promise<KioskDocument[]> {
    return this.repo.list({ ...filters, enabledOnly: filters.enabledOnly ?? false });
  }

  async getDetail(id: string): Promise<KioskDocumentDetail | null> {
    const document = await this.repo.findById(id);
    if (!document || !document.enabled) {
      return null;
    }
    const pageUrls = await this.render.convertPdfToPageUrls(document.id, document.filePath);
    return { document, pageUrls };
  }

  async getDetailForAdmin(id: string): Promise<KioskDocumentDetail | null> {
    const document = await this.repo.findById(id);
    if (!document) {
      return null;
    }
    const pageUrls = await this.render.convertPdfToPageUrls(document.id, document.filePath);
    return { document, pageUrls };
  }

  async deleteDocument(id: string): Promise<void> {
    const document = await this.repo.findById(id);
    if (!document) {
      throw new ApiError(404, '要領書が見つかりません', undefined, 'KIOSK_DOC_NOT_FOUND');
    }
    const pdfUrl = `/api/storage/pdfs/${path.basename(document.filePath)}`;
    await this.render.deletePageImages(document.id);
    await this.fileStore.deletePdfByStorageUrl(pdfUrl);
    await this.repo.delete(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<KioskDocument> {
    return this.repo.update(id, { enabled });
  }
}
