import { createHash } from 'crypto';
import path from 'path';

import type { KioskDocument, Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import type { KioskDocumentListFilters, KioskDocumentRepositoryPort } from './ports/kiosk-document-repository.port.js';
import type { PdfFileStorePort } from './ports/pdf-file-store.port.js';
import type { PdfRenderPort } from './ports/pdf-render.port.js';
import type { HtmlToPdfPort } from './ports/html-to-pdf.port.js';
import { normalizeKioskGmailLogicalKey } from './kiosk-document-gmail-logical-key.js';

export type KioskDocumentDetail = {
  document: KioskDocument;
  pageUrls: string[];
};

/** Gmail 取り込み（createFromGmail*）の結果。ingestion のカウンタ語彙と揃える */
export type KioskGmailImportSkippedReason = 'duplicate_same_mail' | 'older_mail';

export type KioskGmailImportResult =
  | { status: 'imported'; mode: 'created' | 'updated'; detail: KioskDocumentDetail }
  | { status: 'skipped'; reason: KioskGmailImportSkippedReason };

export function buildGmailDedupeKey(messageId: string, attachmentFilename: string): string {
  return createHash('sha256').update(`${messageId}|${attachmentFilename}`, 'utf8').digest('hex');
}

/** Gmail HTML 添付を PDF 保存用ファイル名へ（storage は .pdf のみ） */
export function deriveStoragePdfFilenameFromHtmlAttachment(htmlFilename: string): string {
  const trimmed = htmlFilename.trim() || 'document.html';
  if (/\.html?$/i.test(trimmed)) {
    return trimmed.replace(/\.html?$/i, '.pdf');
  }
  return `${trimmed}.pdf`;
}

/**
 * キオスク要領書のユースケース（保存・一覧・表示用メタデータ）
 */
export class KioskDocumentService {
  constructor(
    private readonly repo: KioskDocumentRepositoryPort,
    private readonly fileStore: PdfFileStorePort,
    private readonly render: PdfRenderPort,
    private readonly htmlToPdf?: HtmlToPdfPort
  ) {}

  private gmailOcrAndCandidatesReset(): Prisma.KioskDocumentUpdateInput {
    return {
      ocrStatus: 'PENDING',
      extractedText: null,
      ocrEngine: null,
      ocrStartedAt: null,
      ocrFinishedAt: null,
      ocrFailureReason: null,
      ocrRetryCount: 0,
      ocrTargetPages: null,
      candidateFhincd: null,
      candidateDrawingNumber: null,
      candidateProcessName: null,
      candidateResourceCd: null,
      candidateDocumentNumber: null,
      confidenceFhincd: null,
      confidenceDrawingNumber: null,
      confidenceProcessName: null,
      confidenceResourceCd: null,
      confidenceDocumentNumber: null,
      documentCategory: null,
      summaryCandidate1: null,
      summaryCandidate2: null,
      summaryCandidate3: null,
    };
  }

  /**
   * Gmail 経由で取り込んだ PDF バイト列を保存し、論理キーで新規作成または上書きする。
   */
  private async ingestGmailFromPdfBuffer(params: {
    logicalKey: string;
    attachmentFilename: string;
    storagePdfFilename: string;
    title: string;
    gmailMessageId: string;
    gmailInternalDateMs: number;
    pdfBuffer: Buffer;
  }): Promise<KioskGmailImportResult> {
    const { logicalKey, attachmentFilename, storagePdfFilename, title } = params;
    const gmailDedupeKey = buildGmailDedupeKey(params.gmailMessageId, attachmentFilename);
    const sameMail = await this.repo.findByGmailDedupeKey(gmailDedupeKey);
    if (sameMail) {
      return { status: 'skipped', reason: 'duplicate_same_mail' };
    }

    const existingLogical = await this.repo.findByGmailLogicalKey(logicalKey);
    const incomingMs = params.gmailInternalDateMs;
    if (existingLogical) {
      // internalDate が取れないメールで既存を誤って上書きしないため、既存あり + 0以下はスキップする
      if (!Number.isFinite(incomingMs) || incomingMs <= 0) {
        return { status: 'skipped', reason: 'older_mail' };
      }
      const storedMs =
        existingLogical.gmailInternalDateMs != null ? Number(existingLogical.gmailInternalDateMs) : 0;
      if (storedMs > 0 && incomingMs <= storedMs) {
        return { status: 'skipped', reason: 'older_mail' };
      }
    }

    const fileHash = createHash('sha256').update(params.pdfBuffer).digest('hex');
    const pathInfo = await this.fileStore.savePdf(storagePdfFilename, params.pdfBuffer);
    const dateBig = BigInt(incomingMs);

    if (existingLogical) {
      await this.render.deletePageImages(existingLogical.id);
      const pdfUrl = `/api/storage/pdfs/${path.basename(existingLogical.filePath)}`;
      await this.fileStore.deletePdfByStorageUrl(pdfUrl).catch(() => undefined);

      const updated = await this.repo.update(existingLogical.id, {
        title,
        filename: pathInfo.filename,
        filePath: pathInfo.filePath,
        fileHash,
        gmailMessageId: params.gmailMessageId,
        sourceAttachmentName: attachmentFilename,
        gmailLogicalKey: logicalKey,
        gmailInternalDateMs: dateBig,
        gmailDedupeKey,
        pageCount: null,
        ...this.gmailOcrAndCandidatesReset(),
      });
      const pageUrls = await this.render.convertPdfToPageUrls(updated.id, pathInfo.filePath);
      const withCount = await this.repo.update(updated.id, { pageCount: pageUrls.length });
      return { status: 'imported', mode: 'updated', detail: { document: withCount, pageUrls } };
    }

    const doc = await this.repo.create({
      title,
      displayTitle: title,
      filename: pathInfo.filename,
      filePath: pathInfo.filePath,
      fileHash,
      sourceType: 'GMAIL',
      gmailMessageId: params.gmailMessageId,
      sourceAttachmentName: attachmentFilename,
      gmailLogicalKey: logicalKey,
      gmailInternalDateMs: dateBig,
      gmailDedupeKey,
      ocrStatus: 'PENDING',
    });
    const pageUrls = await this.render.convertPdfToPageUrls(doc.id, pathInfo.filePath);
    const withCount = await this.repo.update(doc.id, { pageCount: pageUrls.length });
    return { status: 'imported', mode: 'created', detail: { document: withCount, pageUrls } };
  }

  async createManualUpload(params: {
    buffer: Buffer;
    originalFilename: string;
    title?: string;
  }): Promise<KioskDocumentDetail> {
    const originalFilename = params.originalFilename.trim() || 'document.pdf';
    if (!originalFilename.toLowerCase().endsWith('.pdf')) {
      throw new ApiError(400, 'PDFファイルのみアップロードできます', undefined, 'KIOSK_DOC_NOT_PDF');
    }
    const fileHash = createHash('sha256').update(params.buffer).digest('hex');
    const pathInfo = await this.fileStore.savePdf(originalFilename, params.buffer);
    const title =
      params.title?.trim() ||
      originalFilename.replace(/\.pdf$/i, '') ||
      'document';
    const doc = await this.repo.create({
      title,
      displayTitle: title,
      filename: pathInfo.filename,
      filePath: pathInfo.filePath,
      fileHash,
      sourceType: 'MANUAL',
      sourceAttachmentName: originalFilename,
      ocrStatus: 'PENDING',
    });
    const pageUrls = await this.render.convertPdfToPageUrls(doc.id, pathInfo.filePath);
    const updated = await this.repo.update(doc.id, { pageCount: pageUrls.length });
    return { document: updated, pageUrls };
  }

  async createFromGmailAttachment(params: {
    buffer: Buffer;
    attachmentFilename: string;
    gmailMessageId: string;
    gmailInternalDateMs: number;
  }): Promise<KioskGmailImportResult> {
    const attachmentFilename = params.attachmentFilename.trim() || 'document.pdf';
    const logicalKey = normalizeKioskGmailLogicalKey(attachmentFilename);
    if (!logicalKey) {
      throw new ApiError(400, '添付ファイル名が不正です', undefined, 'KIOSK_DOC_GMAIL_FILENAME_INVALID');
    }
    const title = attachmentFilename.replace(/\.pdf$/i, '') || 'document';
    return this.ingestGmailFromPdfBuffer({
      logicalKey,
      attachmentFilename,
      storagePdfFilename: attachmentFilename,
      title,
      gmailMessageId: params.gmailMessageId,
      gmailInternalDateMs: params.gmailInternalDateMs,
      pdfBuffer: params.buffer,
    });
  }

  /**
   * Gmail の HTML 添付を PDF 化して要領書として登録する。
   * `sourceAttachmentName` は元の .html 名、`filePath` は生成 PDF。
   */
  async createFromGmailHtmlAttachment(params: {
    htmlBuffer: Buffer;
    attachmentFilename: string;
    gmailMessageId: string;
    gmailInternalDateMs: number;
  }): Promise<KioskGmailImportResult> {
    if (!this.htmlToPdf) {
      throw new ApiError(
        500,
        'HTML要領書の取り込みに必要な変換器が未設定です',
        undefined,
        'KIOSK_DOC_HTML_TO_PDF_NOT_CONFIGURED'
      );
    }
    const attachmentFilename = params.attachmentFilename.trim() || 'document.html';
    const logicalKey = normalizeKioskGmailLogicalKey(attachmentFilename);
    if (!logicalKey) {
      throw new ApiError(400, '添付ファイル名が不正です', undefined, 'KIOSK_DOC_GMAIL_FILENAME_INVALID');
    }
    const html = params.htmlBuffer.toString('utf8');
    const pdfBuffer = await this.htmlToPdf.convert(html);
    const storageFilename = deriveStoragePdfFilenameFromHtmlAttachment(attachmentFilename);
    const title = storageFilename.replace(/\.pdf$/i, '') || 'document';
    return this.ingestGmailFromPdfBuffer({
      logicalKey,
      attachmentFilename,
      storagePdfFilename: storageFilename,
      title,
      gmailMessageId: params.gmailMessageId,
      gmailInternalDateMs: params.gmailInternalDateMs,
      pdfBuffer,
    });
  }

  async listForKiosk(filters: KioskDocumentListFilters): Promise<KioskDocument[]> {
    return this.repo.list({ ...filters, enabledOnly: true, includeCandidateInSearch: false });
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

  async listPendingProcessing(limit = 100): Promise<KioskDocument[]> {
    return this.repo.listPendingProcessing(limit);
  }

  async updateMetadata(
    id: string,
    input: {
      displayTitle?: string | null;
      confirmedFhincd?: string | null;
      confirmedDrawingNumber?: string | null;
      confirmedProcessName?: string | null;
      confirmedResourceCd?: string | null;
      documentCategory?: string | null;
      confirmedDocumentNumber?: string | null;
      confirmedSummaryText?: string | null;
      actorUserId?: string;
    }
  ): Promise<KioskDocument> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new ApiError(404, '要領書が見つかりません', undefined, 'KIOSK_DOC_NOT_FOUND');
    }

    const updated = await this.repo.update(id, {
      displayTitle: input.displayTitle ?? null,
      confirmedFhincd: input.confirmedFhincd ?? null,
      confirmedDrawingNumber: input.confirmedDrawingNumber ?? null,
      confirmedProcessName: input.confirmedProcessName ?? null,
      confirmedResourceCd: input.confirmedResourceCd ?? null,
      documentCategory: input.documentCategory ?? null,
      confirmedDocumentNumber: input.confirmedDocumentNumber ?? null,
      confirmedSummaryText: input.confirmedSummaryText ?? null,
    });

    const changedFields: string[] = [];
    if ((existing.displayTitle ?? null) !== (updated.displayTitle ?? null)) changedFields.push('displayTitle');
    if ((existing.confirmedFhincd ?? null) !== (updated.confirmedFhincd ?? null)) changedFields.push('confirmedFhincd');
    if ((existing.confirmedDrawingNumber ?? null) !== (updated.confirmedDrawingNumber ?? null)) changedFields.push('confirmedDrawingNumber');
    if ((existing.confirmedProcessName ?? null) !== (updated.confirmedProcessName ?? null)) changedFields.push('confirmedProcessName');
    if ((existing.confirmedResourceCd ?? null) !== (updated.confirmedResourceCd ?? null)) changedFields.push('confirmedResourceCd');
    if ((existing.documentCategory ?? null) !== (updated.documentCategory ?? null)) changedFields.push('documentCategory');

    if (changedFields.length > 0) {
      await this.repo.createMetadataHistory({
        kioskDocument: { connect: { id } },
        actorUserId: input.actorUserId ?? null,
        changedFields,
        previousDisplayTitle: existing.displayTitle,
        nextDisplayTitle: updated.displayTitle,
        previousFhincd: existing.confirmedFhincd,
        nextFhincd: updated.confirmedFhincd,
        previousDrawingNumber: existing.confirmedDrawingNumber,
        nextDrawingNumber: updated.confirmedDrawingNumber,
        previousProcessName: existing.confirmedProcessName,
        nextProcessName: updated.confirmedProcessName,
        previousResourceCd: existing.confirmedResourceCd,
        nextResourceCd: updated.confirmedResourceCd,
        previousCategory: existing.documentCategory,
        nextCategory: updated.documentCategory,
      });
    }

    return updated;
  }
}
