import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import type { KioskDocumentOcrStatus, KioskDocumentSource } from '@prisma/client';

import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../lib/kiosk-document-auth.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { PdfStorageFileStoreAdapter } from '../services/kiosk-documents/adapters/pdf-storage-file-store.adapter.js';
import { PdfStorageRenderAdapter } from '../services/kiosk-documents/adapters/pdf-storage-render.adapter.js';
import { PlaywrightHtmlToPdfAdapter } from '../services/kiosk-documents/adapters/playwright-html-to-pdf.adapter.js';
import { PrismaKioskDocumentRepository } from '../services/kiosk-documents/adapters/prisma-kiosk-document.repository.js';
import { KioskDocumentGmailIngestionService } from '../services/kiosk-documents/kiosk-document-gmail-ingestion.service.js';
import { createDefaultKioskDocumentProcessingService } from '../services/kiosk-documents/kiosk-document-processing.factory.js';
import { getKioskDocumentOcrScheduler } from '../services/kiosk-documents/kiosk-document-ocr.scheduler.js';
import { withDocumentSummaryOnDemandRuntime } from '../services/kiosk-documents/kiosk-document-summary-on-demand-runtime.js';
import type { KioskDocumentDetail } from '../services/kiosk-documents/kiosk-document.service.js';
import { KioskDocumentService } from '../services/kiosk-documents/kiosk-document.service.js';
import { isValidKioskDocumentNumber } from '../services/kiosk-documents/kiosk-document-number.js';
import { normalizeDocumentText } from '../services/kiosk-documents/kiosk-document-text-normalizer.js';

async function readMultipartFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const listQuerySchema = z.object({
  q: z.string().optional(),
  sourceType: z.enum(['MANUAL', 'GMAIL']).optional(),
  ocrStatus: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  includeCandidates: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
  /** 管理画面: true のとき無効ドキュメントを除外（デフォルトは全件表示） */
  hideDisabled: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const ingestBodySchema = z.object({
  scheduleId: z.string().optional(),
});

const patchBodySchema = z.object({
  enabled: z.boolean(),
});

const metadataPatchBodySchema = z.object({
  displayTitle: z.string().trim().min(1).max(200).nullable().optional(),
  confirmedFhincd: z.string().trim().min(1).max(100).nullable().optional(),
  confirmedDrawingNumber: z.string().trim().min(1).max(120).nullable().optional(),
  confirmedProcessName: z.string().trim().min(1).max(120).nullable().optional(),
  confirmedResourceCd: z.string().trim().min(1).max(100).nullable().optional(),
  documentCategory: z.string().trim().min(1).max(120).nullable().optional(),
  confirmedDocumentNumber: z.string().trim().min(1).max(64).nullable().optional(),
  confirmedSummaryText: z.string().trim().min(1).max(300).nullable().optional(),
});

function toDocumentDto(doc: {
  id: string;
  title: string;
  displayTitle: string | null;
  filename: string;
  extractedText: string | null;
  ocrStatus: KioskDocumentOcrStatus;
  ocrEngine: string | null;
  ocrStartedAt: Date | null;
  ocrFinishedAt: Date | null;
  ocrRetryCount: number;
  ocrFailureReason: string | null;
  candidateFhincd: string | null;
  candidateDrawingNumber: string | null;
  candidateProcessName: string | null;
  candidateResourceCd: string | null;
  candidateDocumentNumber: string | null;
  summaryCandidate1: string | null;
  summaryCandidate2: string | null;
  summaryCandidate3: string | null;
  confidenceFhincd: number | null;
  confidenceDrawingNumber: number | null;
  confidenceProcessName: number | null;
  confidenceResourceCd: number | null;
  confidenceDocumentNumber: number | null;
  confirmedFhincd: string | null;
  confirmedDrawingNumber: string | null;
  confirmedProcessName: string | null;
  confirmedResourceCd: string | null;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  documentCategory: string | null;
  sourceType: KioskDocumentSource;
  gmailMessageId: string | null;
  sourceAttachmentName: string | null;
  pageCount: number | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    title: doc.title,
    displayTitle: doc.displayTitle,
    filename: doc.filename,
    extractedText: doc.extractedText,
    ocrStatus: doc.ocrStatus,
    ocrEngine: doc.ocrEngine,
    ocrStartedAt: doc.ocrStartedAt?.toISOString() ?? null,
    ocrFinishedAt: doc.ocrFinishedAt?.toISOString() ?? null,
    ocrRetryCount: doc.ocrRetryCount,
    ocrFailureReason: doc.ocrFailureReason,
    candidateFhincd: doc.candidateFhincd,
    candidateDrawingNumber: doc.candidateDrawingNumber,
    candidateProcessName: doc.candidateProcessName,
    candidateResourceCd: doc.candidateResourceCd,
    candidateDocumentNumber: doc.candidateDocumentNumber,
    summaryCandidate1: doc.summaryCandidate1,
    summaryCandidate2: doc.summaryCandidate2,
    summaryCandidate3: doc.summaryCandidate3,
    confidenceFhincd: doc.confidenceFhincd,
    confidenceDrawingNumber: doc.confidenceDrawingNumber,
    confidenceProcessName: doc.confidenceProcessName,
    confidenceResourceCd: doc.confidenceResourceCd,
    confidenceDocumentNumber: doc.confidenceDocumentNumber,
    confirmedFhincd: doc.confirmedFhincd,
    confirmedDrawingNumber: doc.confirmedDrawingNumber,
    confirmedProcessName: doc.confirmedProcessName,
    confirmedResourceCd: doc.confirmedResourceCd,
    confirmedDocumentNumber: doc.confirmedDocumentNumber,
    confirmedSummaryText: doc.confirmedSummaryText,
    documentCategory: doc.documentCategory,
    sourceType: doc.sourceType,
    gmailMessageId: doc.gmailMessageId,
    sourceAttachmentName: doc.sourceAttachmentName,
    pageCount: doc.pageCount,
    enabled: doc.enabled,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toDetailDto(detail: KioskDocumentDetail) {
  return {
    document: toDocumentDto(detail.document),
    pageUrls: detail.pageUrls,
  };
}

export function registerKioskDocumentRoutes(app: FastifyInstance): void {
  const repo = new PrismaKioskDocumentRepository();
  const service = new KioskDocumentService(
    repo,
    new PdfStorageFileStoreAdapter(),
    new PdfStorageRenderAdapter(),
    new PlaywrightHtmlToPdfAdapter()
  );
  const processingService = createDefaultKioskDocumentProcessingService(repo);
  const gmailIngestion = new KioskDocumentGmailIngestionService(service);

  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  const preView = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
  };

  app.get(
    '/kiosk-documents',
    { config: { rateLimit: false }, preHandler: preView },
    async (request) => {
      const query = listQuerySchema.parse(request.query ?? {});
      const sourceType = query.sourceType as KioskDocumentSource | undefined;
      const ocrStatus = query.ocrStatus as KioskDocumentOcrStatus | undefined;
      const normalizedQuery = query.q ? normalizeDocumentText(query.q) : undefined;
      const hasClientKey = Boolean(request.headers['x-client-key']);

      const documents = hasClientKey
        ? await service.listForKiosk({ query: normalizedQuery, sourceType, ocrStatus })
        : await service.listForAdmin({
            query: normalizedQuery,
            sourceType,
            ocrStatus,
            includeCandidateInSearch: query.includeCandidates === true,
            enabledOnly: query.hideDisabled === true,
          });

      return { documents: documents.map((d) => toDocumentDto(d)) };
    }
  );

  app.post(
    '/kiosk-documents/ingest-gmail',
    { preHandler: [canManage] },
    async (request) => {
      const body = ingestBodySchema.parse((request.body as Record<string, unknown>) ?? {});
      const config = await BackupConfigLoader.load();
      if (body.scheduleId) {
        const result = await gmailIngestion.ingestByScheduleId(config, body.scheduleId);
        return { results: [result] };
      }
      const results = await gmailIngestion.ingestAllEnabledSchedules(config);
      return { results };
    }
  );

  app.get(
    '/kiosk-documents/:id',
    { config: { rateLimit: false }, preHandler: preView },
    async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const hasClientKey = Boolean(request.headers['x-client-key']);
      const detail = hasClientKey
        ? await service.getDetail(id)
        : await service.getDetailForAdmin(id);
      if (!detail) {
        throw new ApiError(404, '要領書が見つかりません', undefined, 'KIOSK_DOC_NOT_FOUND');
      }
      return toDetailDto(detail);
    }
  );

  app.post('/kiosk-documents', { preHandler: [canManage] }, async (request: FastifyRequest) => {
    if (!request.isMultipart()) {
      throw new ApiError(
        400,
        'multipart/form-data が必要です',
        undefined,
        'KIOSK_DOC_MULTIPART_REQUIRED'
      );
    }

    let fileBuffer: Buffer | null = null;
    let uploadFilename = '';
    let title = '';

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileBuffer = await readMultipartFile(part as MultipartFile);
        uploadFilename = part.filename || 'document.pdf';
      } else if (part.type === 'field' && part.fieldname === 'title') {
        title = String(part.value ?? '');
      }
    }

    if (!fileBuffer) {
      throw new ApiError(400, 'PDFファイルが必要です', undefined, 'KIOSK_DOC_FILE_REQUIRED');
    }

    const detail = await service.createManualUpload({
      buffer: fileBuffer,
      originalFilename: uploadFilename,
      title: title.trim() || undefined,
    });
    return toDetailDto(detail);
  });

  app.patch('/kiosk-documents/:id', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = patchBodySchema.parse(request.body ?? {});
    const updated = await service.setEnabled(id, body.enabled);
    return { document: toDocumentDto(updated) };
  });

  app.patch('/kiosk-documents/:id/metadata', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = metadataPatchBodySchema.parse(request.body ?? {});
    if (body.confirmedDocumentNumber && !isValidKioskDocumentNumber(body.confirmedDocumentNumber)) {
      throw new ApiError(400, '文書番号の形式が不正です', undefined, 'KIOSK_DOC_INVALID_DOCUMENT_NUMBER');
    }
    const updated = await service.updateMetadata(id, {
      ...body,
      actorUserId: request.user?.id,
    });
    return { document: toDocumentDto(updated) };
  });

  app.post('/kiosk-documents/:id/reprocess', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await withDocumentSummaryOnDemandRuntime(() => processingService.processDocumentById(id, { maxRetry: 1 }));
    const detail = await service.getDetailForAdmin(id);
    if (!detail) {
      throw new ApiError(404, '要領書が見つかりません', undefined, 'KIOSK_DOC_NOT_FOUND');
    }
    return toDetailDto(detail);
  });

  app.post('/kiosk-documents/run-nightly-ocr', { preHandler: [canManage] }, async () => {
    await getKioskDocumentOcrScheduler().runOnce();
    return { success: true };
  });

  app.delete('/kiosk-documents/:id', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.deleteDocument(id);
    return { success: true };
  });
}
