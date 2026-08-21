import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import {
  resolveAssemblyProcedureMultipartReadLimit
} from '../../lib/assembly-procedure-document-import.js';
import { convertDrawingUploadToPreviewBuffer } from '../../lib/part-measurement-drawing-preview.js';
import {
  AssemblyProcedureDocumentService,
  AssemblyProcedureDraftImportService,
  assemblyProcedureAssetUrl,
  serializeAssemblyProcedureOverlayElement,
  type AssemblyProcedureDocumentSummary,
  type AssemblyProcedureGmailImportService
} from '../../services/assembly/index.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const optionalTrueOnlyBooleanSchema = z
  .union([z.literal('true'), z.literal(true)])
  .optional()
  .transform((value) => value === true || value === 'true');

type ProcedureDocumentLike = {
  id: string;
  name: string;
  imageRelativePath: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  revisionMetadata?: {
    revisionRootId: string;
    revisionNumber: number;
    supersedesDocumentId: string | null;
    isRevisionHead: boolean;
    editVersion: number;
    sourceAssetId: string | null;
  } | null;
  pages?: Array<{
    pageIndex: number;
    imageRelativePath: string;
  }>;
  overlayElements?: Parameters<typeof serializeAssemblyProcedureOverlayElement>[0][];
};

export type AssemblyProcedureDocumentRouteOptions = {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  procedureService: AssemblyProcedureDocumentService;
  procedureDraftImportService: AssemblyProcedureDraftImportService;
  procedureGmailImportService: AssemblyProcedureGmailImportService;
};

export function serializeProcedureDocument(doc: ProcedureDocumentLike) {
  const assets: Record<string, {
    assetId: string;
    storageKey: string;
    contentType: string;
    byteSize: number;
    url: string;
  }> = {};
  const overlaysByPage = new Map<number, ReturnType<typeof serializeAssemblyProcedureOverlayElement>[]>();
  for (const overlay of doc.overlayElements ?? []) {
    if (overlay.asset) {
      assets[overlay.asset.id] = {
        assetId: overlay.asset.id,
        storageKey: overlay.asset.storageKey,
        contentType: overlay.asset.contentType,
        byteSize: overlay.asset.byteSize,
        url: assemblyProcedureAssetUrl(overlay.asset.id, overlay.asset.storageKey)
      };
    }
    const values = overlaysByPage.get(overlay.pageIndex) ?? [];
    values.push(serializeAssemblyProcedureOverlayElement(overlay));
    overlaysByPage.set(overlay.pageIndex, values);
  }
  return {
    id: doc.id,
    name: doc.name,
    imageRelativePath: doc.imageRelativePath,
    status: AssemblyProcedureDocumentService.toStatusDto(doc.status),
    publishedAt: doc.publishedAt?.toISOString() ?? null,
    isActive: doc.isActive,
    revisionRootId: doc.revisionMetadata?.revisionRootId ?? null,
    revisionNumber: doc.revisionMetadata?.revisionNumber ?? 1,
    supersedesDocumentId: doc.revisionMetadata?.supersedesDocumentId ?? null,
    isRevisionHead: doc.revisionMetadata?.isRevisionHead ?? true,
    editVersion: doc.revisionMetadata?.editVersion ?? 0,
    sourceAssetId: doc.revisionMetadata?.sourceAssetId ?? null,
    pages: (doc.pages ?? []).map((page) => ({
      pageIndex: page.pageIndex,
      imageRelativePath: page.imageRelativePath,
      assetId: null,
      overlays: overlaysByPage.get(page.pageIndex) ?? []
    })),
    assets,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

export function serializeProcedureDocumentSummary(doc: AssemblyProcedureDocumentSummary) {
  return {
    ...serializeProcedureDocument(doc),
    activeTemplateCount: doc.activeTemplateCount,
    totalTemplateCount: doc.totalTemplateCount
  };
}

async function readMultipartFile(
  file: MultipartFile,
  maxBytes: number,
  tooLargeMessage: string
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of file.file) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new ApiError(400, tooLargeMessage);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function registerAssemblyProcedureDocumentRoutes(
  app: FastifyInstance,
  options: AssemblyProcedureDocumentRouteOptions
): void {
  const {
    allowView,
    allowWriteKiosk,
    procedureService,
    procedureDraftImportService,
    procedureGmailImportService
  } = options;

  app.post('/assembly/procedure-documents/preview', { preHandler: allowWriteKiosk }, async (request, reply) => {
    if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
    let fileBuffer: Buffer | null = null;
    let mimetype = '';
    let filename = '';
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const mf = part as MultipartFile;
        mimetype = mf.mimetype || '';
        filename = mf.filename || 'procedure';
        const { maxBytes, tooLargeMessage } = resolveAssemblyProcedureMultipartReadLimit(mimetype, filename);
        fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
      }
    }
    if (!fileBuffer) throw new ApiError(400, '手順書ファイルが必要です');
    const { buffer, contentType } = await convertDrawingUploadToPreviewBuffer({ buffer: fileBuffer, mimetype, filename });
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(buffer);
  });

  app.get('/assembly/procedure-documents', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const documents = await procedureService.list({ includeInactive: q.includeInactive, q: q.q, limit: q.limit });
    return { documents: documents.map(serializeProcedureDocument) };
  });

  app.get('/assembly/procedure-documents/summary', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        includeInactive: optionalTrueOnlyBooleanSchema,
        q: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional()
      })
      .parse(request.query);
    const documents = await procedureService.listSummary({ includeInactive: q.includeInactive, q: q.q, limit: q.limit });
    return { documents: documents.map(serializeProcedureDocumentSummary) };
  });

  app.get('/assembly/procedure-documents/:id', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const doc = await procedureService.getById(params.id, { includeInactive: true });
    if (!doc) return reply.status(404).send({ message: '手順書が見つかりません' });
    return { document: serializeProcedureDocument(doc) };
  });

  app.post('/assembly/procedure-documents', { preHandler: allowWriteKiosk }, async (request) => {
    if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
    let fileBuffer: Buffer | null = null;
    let mimetype = '';
    let filename = '';
    let name = '';
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const mf = part as MultipartFile;
        mimetype = mf.mimetype || '';
        filename = mf.filename || 'procedure';
        const { maxBytes, tooLargeMessage } = resolveAssemblyProcedureMultipartReadLimit(mimetype, filename);
        fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
      } else if (part.type === 'field' && part.fieldname === 'name') {
        name = String(part.value ?? '').trim();
      }
    }
    if (!fileBuffer) throw new ApiError(400, '手順書ファイルが必要です');
    const doc = await procedureDraftImportService.importDraft({
      name: name || filename.replace(/\.[^.]+$/, '') || '組立手順書',
      buffer: fileBuffer,
      mimetype,
      filename
    });
    return { document: serializeProcedureDocument(doc) };
  });

  app.post('/assembly/procedure-documents/ingest-gmail', { preHandler: allowWriteKiosk }, async () => {
    const result = await procedureGmailImportService.ingest();
    return {
      result: {
        ...result,
        items: result.items.map((item) => ({
          messageId: item.messageId,
          filename: item.filename,
          status: item.status,
          document: item.document ? serializeProcedureDocument(item.document) : null,
          error: item.error
        }))
      }
    };
  });

  app.post('/assembly/procedure-documents/:id/publish', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z
      .object({
        accessPassword: z.string().max(128),
        expectedEditVersion: z.coerce.number().int().min(0).optional()
      })
      .parse(request.body ?? {});
    const doc = await procedureService.publish(params.id, body);
    return { document: serializeProcedureDocument(doc) };
  });

  app.post('/assembly/procedure-documents/:id/unpublish', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const doc = await procedureService.unpublish(params.id);
    return { document: serializeProcedureDocument(doc) };
  });

  app.patch('/assembly/procedure-documents/:id', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(request.body);
    const doc = await procedureService.rename(params.id, body.name);
    return { document: serializeProcedureDocument(doc) };
  });

  app.delete('/assembly/procedure-documents/:id', { preHandler: allowWriteKiosk }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const usage = await procedureService.getReferenceUsage(params.id);
    if (usage.inBoltPageRef || usage.inCheckPageRef) {
      return reply.status(409).send({ message: 'マーカー参照で使用中の手順書は削除できません' });
    }
    const result = await procedureService.deleteIfUnused(params.id);
    if (result === 'not_found') return reply.status(404).send({ message: '手順書が見つかりません' });
    if (result === 'in_use') return reply.status(409).send({ message: 'テンプレートで使用中の手順書は削除できません' });
    return reply.status(204).send();
  });
}
