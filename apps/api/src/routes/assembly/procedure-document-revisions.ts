import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import {
  assemblyProcedureOverlayRegionInputSchema,
  assemblyProcedureOverlaySaveInputSchema
} from '@raspi-system/shared-types';

import {
  AssemblyProcedureDocumentAssetsService,
  AssemblyProcedureDocumentRevisionService,
  serializeAssemblyProcedureDocumentRevision
} from '../../services/assembly/index.js';
import { ApiError } from '../../lib/errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
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
      const document = await service.createRevision(params.id, body.accessPassword);
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/assets',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const multipart = await readOverlayMultipart(request);
      const asset = await assetsService.uploadOverlayImage({
        documentId: params.id,
        accessPassword: multipart.accessPassword,
        bytes: multipart.bytes,
        contentType: multipart.contentType,
        originalFileName: multipart.originalFileName
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/regions/image',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlayRegionInputSchema.parse(request.body ?? {});
      const asset = await assetsService.createImageRegion({
        documentId: params.id,
        accessPassword: body.accessPassword,
        pageIndex: body.pageIndex,
        bbox: body.bbox
      });
      return { asset };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/regions/text',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlayRegionInputSchema.parse(request.body ?? {});
      const candidates = await assetsService.findTextCandidates({
        documentId: params.id,
        accessPassword: body.accessPassword,
        pageIndex: body.pageIndex,
        bbox: body.bbox
      });
      return { candidates };
    }
  );

  app.put(
    '/assembly/procedure-documents/:id/overlays',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = assemblyProcedureOverlaySaveInputSchema.parse(request.body ?? {});
      const document = await service.saveOverlays({
        documentId: params.id,
        accessPassword: body.accessPassword,
        expectedEditVersion: body.expectedEditVersion,
        elements: body.elements
      });
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );

  app.post(
    '/assembly/procedure-documents/:id/discard-revision',
    { preHandler: options.allowWriteKiosk },
    async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = discardRevisionBodySchema.parse(request.body ?? {});
      const document = await service.discardRevision({
        documentId: params.id,
        accessPassword: body.accessPassword,
        expectedEditVersion: body.expectedEditVersion
      });
      return { document: serializeAssemblyProcedureDocumentRevision(document) };
    }
  );
}
