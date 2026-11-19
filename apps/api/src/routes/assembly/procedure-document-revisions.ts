import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  assemblyProcedureOverlayRegionInputSchema,
  assemblyProcedureOverlaySaveInputSchema,
  procedureLayoutSuggestionRequestSchema
} from '@raspi-system/shared-types';

import {
  AssemblyProcedureDocumentAssetsService,
  AssemblyProcedureDocumentRevisionService,
  serializeAssemblyProcedureDocumentRevision
} from '../../services/assembly/index.js';
import { canWriteAssemblyProcedureDocument, enforceAssemblyProcedureEditLease, resolveAssemblyProcedureEditWriter } from './procedure-document-edit-leases.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureDocumentBlankService } from '../../services/assembly/assembly-procedure-document-blank.service.js';
import { ProcedureMaterialPlacementService } from '../../services/assembly/procedure-material-placement.service.js';
import { ProcedureDictationRewriteService } from '../../services/assembly/procedure-dictation-rewrite.service.js';
import { documentSite } from '../../services/assembly/procedure-document-site.js';
import { ProcedureSpeechToTextService, PROCEDURE_AUDIO_MAX_BYTES, procedureSpeechToTextError } from '../../services/assembly/procedure-speech-to-text.service.js';
import { ProcedureLayoutSuggestionService } from '../../services/assembly/procedure-layout-suggestion.service.js';
import { resolveMeetingTranscriptionProvider } from '../../services/inference/adapters/http-meeting-transcription.adapter.js';
import {
  PROCEDURE_MEETING_MAX_BYTES, PROCEDURE_MEETING_RETENTION_MS, getProcedureMeetingAudioDir, procedureMeetingTranscriptionWorker
} from '../../services/assembly/procedure-meeting-transcription.worker.js';
import { requireClientDevice } from '../kiosk/shared.js';

const meetingRoute = '/assembly/procedure-documents/dictation/meetings';
const meetingMimeTypes = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave']);

async function meetingOwner(request: FastifyRequest) {
  if (request.headers['x-client-key'] === undefined && request.user) return `user:${request.user.id}`;
  const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
  return `device:${clientDevice.id}`;
}

const idParamsSchema = z.object({ id: z.string().guid() });
const accessPasswordSchema = z.string().max(128).default('');
const createRevisionBodySchema = z.object({
  accessPassword: accessPasswordSchema
});
const discardRevisionBodySchema = z.object({
  accessPassword: accessPasswordSchema,
  expectedEditVersion: z.coerce.number().int().min(0).optional()
});

type AssemblyRevisionRouteOptions = {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
};

/**
 * Dedicated revision/overlay routes. Existing library routes remain in
 * `assembly/index.ts`; this module owns only the version editing contract.
 */
export function registerAssemblyProcedureDocumentRevisionRoutes(
  app: FastifyInstance,
  options: AssemblyRevisionRouteOptions,
  service = new AssemblyProcedureDocumentRevisionService(),
  assetsService = new AssemblyProcedureDocumentAssetsService()
): void {
  app.get('/assembly/procedure-documents/dictation/speech-to-text', {
    preHandler: options.allowWriteKiosk
  }, async () => ({
    available: await new ProcedureSpeechToTextService().isAvailable(),
    meetingAvailable: resolveMeetingTranscriptionProvider() !== null
  }));
  app.post(meetingRoute, {
    preHandler: options.allowWriteKiosk,
    config: { rateLimit: { max: 4, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!resolveMeetingTranscriptionProvider()) throw procedureSpeechToTextError(503);
    if (!request.isMultipart()) throw procedureSpeechToTextError(400);
    const ownerKey = await meetingOwner(request);
    const id = randomUUID();
    const directory = getProcedureMeetingAudioDir();
    const audioPath = join(directory, id);
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once('close', disconnected);
    let accepted = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let audioBytes = 0;
      let mimeType: string | undefined;
      try {
        // Busboy marks a file truncated when it reaches the limit, so read at most one extra byte.
        for await (const part of request.parts({ limits: { fileSize: PROCEDURE_MEETING_MAX_BYTES + 1, files: 1, fields: 0, parts: 2 } })) {
          if (part.type !== 'file' || part.fieldname !== 'audio' || mimeType) throw procedureSpeechToTextError(400);
          mimeType = part.mimetype.split(';', 1)[0];
          if (!mimeType || !meetingMimeTypes.has(mimeType)) throw procedureSpeechToTextError(400);
          const output = createWriteStream(audioPath, { flags: 'wx', mode: 0o600 });
          await pipeline(part.file, output, { signal: controller.signal });
          audioBytes = output.bytesWritten;
          if (part.file.truncated || audioBytes > PROCEDURE_MEETING_MAX_BYTES) throw procedureSpeechToTextError(413);
        }
      } catch (error) {
        if (controller.signal.aborted) throw procedureSpeechToTextError(499);
        if (error instanceof ApiError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') throw procedureSpeechToTextError(413);
        if (code && !code.startsWith('FST_')) throw procedureSpeechToTextError(503);
        throw procedureSpeechToTextError(400);
      }
      if (!audioBytes || !mimeType) throw procedureSpeechToTextError(400);
      if (controller.signal.aborted) throw procedureSpeechToTextError(499);
      await prisma.procedureMeetingTranscriptionJob.create({ data: { id, ownerKey, audioPath, audioBytes, mimeType } });
      accepted = true;
      procedureMeetingTranscriptionWorker.kick();
      return reply.code(202).send({ jobId: id });
    } finally {
      reply.raw.off('close', disconnected);
      if (!accepted) await rm(audioPath, { force: true }).catch(() => request.log.warn('procedure_meeting_upload_cleanup_failed'));
    }
  });

  app.get(`${meetingRoute}/:jobId`, { preHandler: options.allowWriteKiosk }, async (request, reply) => {
    const { id } = idParamsSchema.parse({ id: (request.params as { jobId: string }).jobId });
    const ownerKey = await meetingOwner(request);
    const job = await prisma.procedureMeetingTranscriptionJob.findFirst({
      where: { id, ownerKey, createdAt: { gt: new Date(Date.now() - PROCEDURE_MEETING_RETENTION_MS) } },
      select: { status: true, resultText: true, errorCode: true }
    });
    if (!job) throw new ApiError(404, '書き起こしが見つかりません');
    reply.header('Cache-Control', 'no-store');
    return {
      status: job.status,
      ...(job.resultText !== null && { text: job.resultText }),
      ...(job.errorCode !== null && { errorCode: job.errorCode })
    };
  });
  app.post('/assembly/procedure-documents/dictation/transcribe', {
    preHandler: options.allowWriteKiosk,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    errorHandler(error, request, reply) {
      // Rate limiting rejects with a plain object; rethrowing it here would be sent as a 200 payload.
      if (!(error instanceof ApiError) || !error.code?.startsWith('ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_')) return app.errorHandler(error, request, reply);
      // The general handler includes error stacks/details; this upload route logs only safe metadata.
      request.log.warn({ status: error.statusCode, code: error.code, aborted: error.statusCode === 499 }, 'assembly_procedure_speech_to_text_failed');
      return reply.code(error.statusCode).send({
        message: error.message, errorCode: error.code, requestId: request.id, timestamp: new Date().toISOString()
      });
    }
  }, async (request, reply) => {
    const abortController = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    reply.raw.once('close', onClose);
    try {
      if (!request.isMultipart()) throw procedureSpeechToTextError(400);
      let audio: Buffer | null = null;
      let contentType = '';
      let hintKey: string | undefined;
      try {
        for await (const part of request.parts({ limits: { fileSize: PROCEDURE_AUDIO_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 64 } })) {
          if (part.type === 'field') {
            if (part.fieldname !== 'context' || hintKey !== undefined || part.valueTruncated || typeof part.value !== 'string') throw procedureSpeechToTextError(400);
            hintKey = part.value;
            continue;
          }
          if (part.fieldname !== 'file' || audio) throw procedureSpeechToTextError(400);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > PROCEDURE_AUDIO_MAX_BYTES) throw procedureSpeechToTextError(413);
            chunks.push(chunk);
          }
          if (part.file.truncated) throw procedureSpeechToTextError(413);
          audio = Buffer.concat(chunks);
          contentType = part.mimetype;
        }
      } catch (error) {
        if (abortController.signal.aborted) throw procedureSpeechToTextError(499);
        if (error instanceof ApiError) throw error;
        const code = (error as { code?: string }).code;
        throw procedureSpeechToTextError(code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400);
      }
      if (!audio?.length) throw procedureSpeechToTextError(400);
      return await new ProcedureSpeechToTextService().transcribe(audio, contentType, abortController.signal, hintKey);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 429) {
        reply.header('Retry-After', String((error.details as { retryAfter?: number } | undefined)?.retryAfter ?? 2));
      }
      throw error;
    } finally {
      reply.raw.off('close', onClose);
    }
  });
  app.post('/assembly/procedure-documents/dictation/rewrite', {
    preHandler: options.allowWriteKiosk,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = z.object({
      mode: z.enum(['new', 'append', 'revise']),
      spokenText: z.string().trim().min(1).max(2000),
      currentText: z.string().max(10000).optional(),
      originalText: z.string().max(10000).optional(),
      documentId: z.string().uuid().optional(),
      pageIndex: z.number().int().min(0).optional(),
      elementId: z.string().min(1).max(200).optional()
    }).refine(body => body.mode !== 'revise' || Boolean(body.currentText?.trim()), {
      path: ['currentText'], message: 'currentText is required for revise'
    }).parse(request.body);
    const abortController = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    reply.raw.once('close', onClose);
    try {
      const { documentId, pageIndex, elementId, originalText: originalElementText, ...input } = body;
      const { signal } = abortController;
      const result = await new ProcedureDictationRewriteService().rewrite({ ...input, ...(documentId === undefined ? {} : { documentId }), signal });
      if (documentId === undefined || pageIndex === undefined || elementId === undefined || signal.aborted) return result;
      const originalText = input.mode === 'new' ? originalElementText ?? '' : input.currentText ?? '';
      const aiText = input.mode === 'append' ? originalText + '\n' + result.text : result.text;
      // The editor cannot apply an append result that exceeds its text limit.
      if (aiText.length > 10000) return result;
      try {
        const document = await prisma.assemblyProcedureDocument.findUnique({
          where: { id: documentId },
          select: { name: true, status: true, isActive: true, revisionMetadata: { select: { revisionRootId: true, isRevisionHead: true } } },
        });
        if (document?.status !== 'DRAFT' || !document.isActive || !document.revisionMetadata?.revisionRootId || !document.revisionMetadata.isRevisionHead) {
          logger.debug({ documentId }, 'assembly_procedure_dictation_feedback_draft_unavailable');
          return result;
        }
        const site = await documentSite(document.revisionMetadata.revisionRootId);
        if (signal.aborted) return result;
        if (!await canWriteAssemblyProcedureDocument(request, documentId)) {
          logger.debug({ documentId }, 'assembly_procedure_dictation_feedback_edit_locked');
          return result;
        }
        if (signal.aborted) return result;
        await prisma.assemblyProcedureTextFeedback.create({ data: {
          documentId, pageIndex, elementId, site, documentName: document.name, source: 'DICTATION',
          mode: input.mode, spokenText: input.spokenText, originalText, aiText,
        } });
      } catch (error) {
        logger.warn({
          documentId,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : undefined,
        }, 'assembly_procedure_dictation_feedback_proposal_failed');
      }
      return result;
    } finally {
      reply.raw.off('close', onClose);
    }
  });
  app.post('/assembly/procedure-documents/blank', { preHandler: options.allowWriteKiosk }, async (request) => {
    const body = z.object({
      name: z.string().trim().min(1).max(200),
      assignment: z.object({ modelCode: z.string().trim().min(1).max(200), processId: z.string().min(1) }).optional()
    }).parse(request.body);
    const result = await new AssemblyProcedureDocumentBlankService().createWithAssignment(body.name, body.assignment);
    return { document: serializeAssemblyProcedureDocumentRevision(result.document), assignmentError: result.assignmentError };
  });
  app.post('/assembly/procedure-documents/:id/pages/blank', { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = z.object({ accessPassword: accessPasswordSchema, expectedEditVersion: z.coerce.number().int().min(0), afterPageIndex: z.number().int().min(0).optional() }).parse(request.body);
    return { document: serializeAssemblyProcedureDocumentRevision(await service.addBlankPage({ documentId: id, ...body, ...await resolveAssemblyProcedureEditWriter(request) })) };
  });
  app.post('/assembly/procedure-documents/:id/pages/import', { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = z.object({
      accessPassword: accessPasswordSchema,
      expectedEditVersion: z.coerce.number().int().min(0),
      sourceDocumentId: z.string().guid(),
      sourcePageIndexes: z.array(z.number().int().min(0)).min(1).refine(indexes => new Set(indexes).size === indexes.length),
      afterPageIndex: z.number().int().min(-1).optional()
    }).parse(request.body);
    return { document: serializeAssemblyProcedureDocumentRevision(await service.importPages({ documentId: id, ...body, ...await resolveAssemblyProcedureEditWriter(request) })) };
  });
  app.post('/assembly/procedure-documents/:id/pages/:pageIndex/delete', { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id, pageIndex } = idParamsSchema.extend({ pageIndex: z.coerce.number().int().min(0) }).parse(request.params);
    const body = z.object({ accessPassword: accessPasswordSchema, expectedEditVersion: z.coerce.number().int().min(0) }).parse(request.body);
    return { document: serializeAssemblyProcedureDocumentRevision(await service.deletePage({ documentId: id, pageIndex, ...body, ...await resolveAssemblyProcedureEditWriter(request) })) };
  });
  app.post('/assembly/procedure-documents/:id/pages/:pageIndex/move', { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id, pageIndex } = idParamsSchema.extend({ pageIndex: z.coerce.number().int().min(0) }).parse(request.params);
    const body = z.object({
      accessPassword: accessPasswordSchema,
      expectedEditVersion: z.coerce.number().int().min(0),
      toPageIndex: z.number().int().min(0)
    }).parse(request.body);
    return { document: serializeAssemblyProcedureDocumentRevision(await service.movePage({ documentId: id, pageIndex, ...body, ...await resolveAssemblyProcedureEditWriter(request) })) };
  });
  app.post('/assembly/procedure-documents/:id/materials/:materialId/place', { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] }, async (request) => {
    const { id, materialId } = z.object({ id: z.string().guid(), materialId: z.string().guid() }).parse(request.params);
    const body = z.object({ accessPassword: accessPasswordSchema, pageIndex: z.coerce.number().int().min(0), employeeTagUid: z.string().trim().min(1).max(128).optional() }).parse(request.body);
    return new ProcedureMaterialPlacementService().place({ documentId: id, materialId, ...body, ...await resolveAssemblyProcedureEditWriter(request) });
  });
  app.post('/assembly/procedure-documents/:id/layout-suggestions', {
    preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease],
    config: { rateLimit: { max: 4, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = procedureLayoutSuggestionRequestSchema.parse(request.body);
    const abortController = new AbortController();
    const onClose = () => { if (!reply.raw.writableEnded) abortController.abort(); };
    reply.raw.once('close', onClose);
    try {
      return await new ProcedureLayoutSuggestionService().suggest({ documentId: id, ...body, ...await resolveAssemblyProcedureEditWriter(request), signal: abortController.signal });
    } finally {
      reply.raw.off('close', onClose);
    }
  });

  async function readOverlayMultipart(request: FastifyRequest) {
    if (!request.isMultipart()) throw new ApiError(400, 'マルチパートフォームデータが必要です');
    let bytes: Buffer | null = null;
    let contentType = '';
    let originalFileName: string | null = null;
    let accessPassword = '';
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of part.file) {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += value.length;
          if (size > 12 * 1024 * 1024) throw new ApiError(400, 'overlay画像が大きすぎます');
          chunks.push(value);
        }
        bytes = Buffer.concat(chunks);
        contentType = part.mimetype;
        originalFileName = part.filename;
      } else if (part.type === 'field' && part.fieldname === 'accessPassword') {
        accessPassword = String(part.value ?? '');
      }
    }
    if (!bytes) throw new ApiError(400, 'overlay画像fileが必要です');
    return { bytes, contentType, originalFileName, accessPassword };
  }

  app.get(
    '/assembly/procedure-documents/:id/revisions',
    { preHandler: options.allowView },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const revisions = await service.listHistory(params.id);
      return {
        revisions: revisions.map(serializeAssemblyProcedureDocumentRevision)
      };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/revisions',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = createRevisionBodySchema.parse(request.body ?? {});
      const document = await service.createRevision(params.id, body.accessPassword, await resolveAssemblyProcedureEditWriter(request));
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/assets',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const multipart = await readOverlayMultipart(request);
      const asset = await assetsService.uploadOverlayImage({
        documentId: params.id,
        ...await resolveAssemblyProcedureEditWriter(request),
        accessPassword: multipart.accessPassword,
        bytes: multipart.bytes,
        contentType: multipart.contentType,
        originalFileName: multipart.originalFileName
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/assets/:assetId/rotate',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const { id, assetId } = idParamsSchema.extend({ assetId: z.string().trim().min(1).max(120) }).parse(request.params);
      const body = z.object({ accessPassword: accessPasswordSchema, direction: z.enum(['left', 'right']) }).parse(request.body ?? {});
      const asset = await assetsService.rotateOverlayImage({
        documentId: id,
        assetId,
        ...await resolveAssemblyProcedureEditWriter(request),
        ...body
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/assets/:assetId/sharpen',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const { id, assetId } = idParamsSchema.extend({ assetId: z.string().guid() }).parse(request.params);
      const { accessPassword } = createRevisionBodySchema.parse(request.body ?? {});
      const asset = await assetsService.sharpenOverlayImage({
        documentId: id,
        assetId,
        accessPassword,
        ...await resolveAssemblyProcedureEditWriter(request)
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/regions/image',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlayRegionInputSchema.parse(request.body ?? {});
      const asset = await assetsService.createImageRegion({
        documentId: params.id,
        ...await resolveAssemblyProcedureEditWriter(request),
        accessPassword: body.accessPassword,
        pageIndex: body.pageIndex,
        bbox: body.bbox,
        ...(body.overlays ? { overlays: body.overlays } : {})
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/regions/text-rewrite',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlayRegionInputSchema.parse(request.body ?? {});
      return assetsService.createTextRewriteRegion({
        documentId: params.id,
        ...await resolveAssemblyProcedureEditWriter(request),
        accessPassword: body.accessPassword,
        pageIndex: body.pageIndex,
        bbox: body.bbox,
        ...(body.overlays ? { overlays: body.overlays } : {})
      });
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/regions/text',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlayRegionInputSchema.parse(request.body ?? {});
      const candidates = await assetsService.findTextCandidates({
        ...await resolveAssemblyProcedureEditWriter(request),
        documentId: params.id,
        accessPassword: body.accessPassword,
        pageIndex: body.pageIndex,
        bbox: body.bbox,
        ...(body.overlays ? { overlays: body.overlays } : {})
      });
      return { candidates };
    }
  );

  app.put(
    '/assembly/procedure-documents/:id/overlays',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlaySaveInputSchema.parse(request.body ?? {});
      const document = await service.saveOverlays({
        documentId: params.id,
        ...await resolveAssemblyProcedureEditWriter(request),
        accessPassword: body.accessPassword,
        expectedEditVersion: body.expectedEditVersion,
        elements: body.elements,
        appliedCaptionElementIds: body.appliedCaptionElementIds
      });
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/discard-revision',
    { preHandler: [options.allowWriteKiosk, enforceAssemblyProcedureEditLease] },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = discardRevisionBodySchema.parse(request.body ?? {});
      const document = await service.discardRevision({
        documentId: params.id,
        ...await resolveAssemblyProcedureEditWriter(request),
        accessPassword: body.accessPassword,
        expectedEditVersion: body.expectedEditVersion
      });
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );
}
