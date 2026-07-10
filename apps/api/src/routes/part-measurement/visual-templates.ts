import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import {
  importDrawingAndSave,
  resolveDrawingMultipartReadLimit
} from '../../lib/part-measurement-drawing-import.js';
import { convertDrawingUploadToPreviewBuffer } from '../../lib/part-measurement-drawing-preview.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';


import { getPartMeasurementDrawingOcrScheduler } from '../../services/part-measurement/part-measurement-drawing-ocr.scheduler.js';
import {
  assertVisualCleanupToken,
  signVisualCleanupToken
} from '../../services/part-measurement/part-measurement-visual-cleanup-token.js';








import {
  optionalQueryTrueOnlyBooleanSchema,
  inspectionDrawingDigitQuerySchema,
  drawingOcrCandidateBodySchema,
  serializeVisualTemplate,
  serializeDrawingOcrStatus,
  serializeDrawingOcrCandidate,
  readMultipartFile,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerVisualTemplateRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowView,
    allowWriteKiosk,
    visualTemplateService,
    drawingOcrService,
    enqueueDrawingOcrAndWake
  } = deps;

    app.get(
      '/part-measurement/visual-templates',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const q = z
          .object({
            includeInactive: optionalQueryTrueOnlyBooleanSchema,
            q: z.string().optional(),
            digitQuery: inspectionDrawingDigitQuerySchema,
            limit: z.coerce.number().int().min(1).max(200).optional(),
            sort: z.enum(['name', 'recentlyUpdated']).optional()
          })
          .parse(request.query);
        const list = await visualTemplateService.list({
          includeInactive: q.includeInactive === true,
          q: q.q,
          digitQuery: q.digitQuery,
          limit: q.limit,
          sort: q.sort
        });
        return { visualTemplates: list.map(serializeVisualTemplate) };
      }
    );

    app.get(
      '/part-measurement/visual-templates/:id',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const q = z
          .object({
            includeInactive: optionalQueryTrueOnlyBooleanSchema
          })
          .parse(request.query);
        const visual = await visualTemplateService.getById(params.id, {
          includeInactive: q.includeInactive === true
        });
        if (!visual) {
          return reply.status(404).send({ message: '図面テンプレートが見つかりません。' });
        }
        return { visualTemplate: serializeVisualTemplate(visual) };
      }
    );

    app.get(
      '/part-measurement/visual-templates/:id/ocr',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const status = await drawingOcrService.getCurrentStatus(params.id);
        if (status.status === 'PENDING') {
          getPartMeasurementDrawingOcrScheduler().wake();
        }
        return { ocr: serializeDrawingOcrStatus(status) };
      }
    );

    app.post(
      '/part-measurement/visual-templates/:id/ocr/candidates',
      { preHandler: allowView, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = drawingOcrCandidateBodySchema.parse(request.body);
        const result = await drawingOcrService.getCandidates(params.id, {
          xRatio: body.xRatio,
          yRatio: body.yRatio,
          markerNo: body.markerNo,
          limit: body.limit ?? 5,
          measurementLabel: body.measurementLabel,
          depthMode: body.depthMode
        });
        return {
          status: result.status.toLowerCase(),
          candidates: result.candidates.map(serializeDrawingOcrCandidate),
          cache: serializeDrawingOcrStatus(result.cache)
        };
      }
    );

    app.post(
      '/part-measurement/visual-templates/:id/ocr/retry',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const status = await drawingOcrService.retryVisualTemplate(params.id);
        getPartMeasurementDrawingOcrScheduler().wake();
        return { ocr: serializeDrawingOcrStatus(status) };
      }
    );

    app.post(
      '/part-measurement/visual-templates',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        if (!request.isMultipart()) {
          throw new ApiError(
            400,
            'マルチパートフォームデータが必要です（name, file）',
            undefined,
            'MULTIPART_REQUIRED'
          );
        }
        let fileBuffer: Buffer | null = null;
        let mimetype = '';
        let filename = '';
        let name = '';

        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname === 'file') {
              const mf = part as MultipartFile;
              mimetype = mf.mimetype || '';
              filename = mf.filename || 'drawing';
              const { maxBytes, tooLargeMessage } = resolveDrawingMultipartReadLimit(mimetype, filename);
              fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
            }
          } else if (part.fieldname === 'name') {
            name = String(part.value ?? '').trim();
          }
        }

        if (!fileBuffer || fileBuffer.length === 0) {
          throw new ApiError(400, '図面ファイルが必要です');
        }
        if (!name) {
          name = filename.replace(/\.[^.]+$/, '') || '図面テンプレート';
        }

        const { relativeUrl } = await importDrawingAndSave({
          buffer: fileBuffer,
          mimetype,
          filename
        });

        let created;
        try {
          created = await visualTemplateService.create({
            name: name.slice(0, 200),
            drawingImageRelativePath: relativeUrl
          });
        } catch (error) {
          await PartMeasurementDrawingStorage.deleteDrawing(relativeUrl).catch(() => undefined);
          throw error;
        }
        await enqueueDrawingOcrAndWake(created.id, 'visual_template_create');
        return {
          visualTemplate: serializeVisualTemplate(created),
          cleanupToken: signVisualCleanupToken(created.id)
        };
      }
    );

    app.patch(
      '/part-measurement/visual-templates/:id',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = z
          .object({
            name: z.string().trim().min(1).max(200)
          })
          .parse(request.body);
        try {
          const updated = await visualTemplateService.updateName(params.id, body.name);
          return { visualTemplate: serializeVisualTemplate(updated) };
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 404) {
            return reply.status(404).send({ message: error.message });
          }
          throw error;
        }
      }
    );

    app.delete(
      '/part-measurement/visual-templates/:id',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request, reply) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const cleanupToken = request.headers['x-visual-cleanup-token'];
        if (typeof cleanupToken !== 'string' || cleanupToken.trim().length === 0) {
          throw new ApiError(400, '図面回収トークンが必要です。', undefined, 'VISUAL_CLEANUP_TOKEN_REQUIRED');
        }
        assertVisualCleanupToken(cleanupToken.trim(), params.id);
        const outcome = await visualTemplateService.deleteIfUnused(params.id);
        if (outcome === 'not_found') {
          return reply.status(404).send({ message: '図面テンプレートが見つかりません。' });
        }
        if (outcome === 'in_use') {
          return reply.status(409).send({
            message: '図面テンプレートは使用中のため削除できません。'
          });
        }
        return reply.status(204).send();
      }
    );

    app.post(
      '/part-measurement/drawings/preview',
      { preHandler: allowWriteKiosk },
      async (request, reply) => {
        if (!request.isMultipart()) {
          throw new ApiError(
            400,
            'マルチパートフォームデータが必要です（file）',
            undefined,
            'MULTIPART_REQUIRED'
          );
        }

        let fileBuffer: Buffer | null = null;
        let mimetype = '';
        let filename = '';

        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            if (part.fieldname === 'file') {
              const mf = part as MultipartFile;
              mimetype = mf.mimetype || '';
              filename = mf.filename || 'drawing';
              const { maxBytes, tooLargeMessage } = resolveDrawingMultipartReadLimit(mimetype, filename);
              fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
            }
          }
        }

        if (!fileBuffer || fileBuffer.length === 0) {
          throw new ApiError(400, '図面ファイルが必要です');
        }

        const { buffer, contentType } = await convertDrawingUploadToPreviewBuffer({
          buffer: fileBuffer,
          mimetype,
          filename
        });

        reply.header('Content-Type', contentType);
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Content-Type-Options', 'nosniff');
        return reply.send(buffer);
      }
    );
}
