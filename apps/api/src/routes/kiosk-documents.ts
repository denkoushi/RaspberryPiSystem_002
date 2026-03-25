import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import type { KioskDocumentSource } from '@prisma/client';

import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../lib/kiosk-document-auth.js';
import { BackupConfigLoader } from '../services/backup/backup-config.loader.js';
import { PdfStorageFileStoreAdapter } from '../services/kiosk-documents/adapters/pdf-storage-file-store.adapter.js';
import { PdfStorageRenderAdapter } from '../services/kiosk-documents/adapters/pdf-storage-render.adapter.js';
import { PrismaKioskDocumentRepository } from '../services/kiosk-documents/adapters/prisma-kiosk-document.repository.js';
import { KioskDocumentGmailIngestionService } from '../services/kiosk-documents/kiosk-document-gmail-ingestion.service.js';
import type { KioskDocumentDetail } from '../services/kiosk-documents/kiosk-document.service.js';
import { KioskDocumentService } from '../services/kiosk-documents/kiosk-document.service.js';

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

function toDocumentDto(doc: {
  id: string;
  title: string;
  filename: string;
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
    filename: doc.filename,
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
  const service = new KioskDocumentService(
    new PrismaKioskDocumentRepository(),
    new PdfStorageFileStoreAdapter(),
    new PdfStorageRenderAdapter()
  );
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
      const hasClientKey = Boolean(request.headers['x-client-key']);

      const documents = hasClientKey
        ? await service.listForKiosk({ query: query.q, sourceType })
        : await service.listForAdmin({
            query: query.q,
            sourceType,
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

  app.delete('/kiosk-documents/:id', { preHandler: [canManage] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await service.deleteDocument(id);
    return { success: true };
  });
}
