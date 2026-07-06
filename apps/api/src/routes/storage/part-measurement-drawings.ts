import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { findClientDeviceByApiKey } from '../../services/clients/client-device-auth.service.js';
import { PartMeasurementDrawingStorage, parseDerivativeWidth } from '../../lib/part-measurement-drawing-storage.js';
import { buildPdfPageEtag, ifNoneMatchSatisfied } from './pdf-page-http-cache.js';

const PART_MEASUREMENT_DRAWING_CACHE_CONTROL = 'private, max-age=86400, immutable';

/**
 * GET /api/storage/part-measurement-drawings/*
 * 図面画像配信。JWT または有効な x-client-key（写真配信と同様）。
 */
export function registerPartMeasurementDrawingStorageRoutes(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/storage/part-measurement-drawings/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
      const client = await findClientDeviceByApiKey(apiKey);
      if (!client) {
        await canView(request, reply);
      }
    } else {
      await canView(request, reply);
    }

    const urlPath = request.url.split('?')[0].replace('/api/storage/part-measurement-drawings/', '');
    if (!urlPath) {
      return reply.status(400).send({ message: '図面のパスが指定されていません' });
    }

    const drawingUrl = `/api/storage/part-measurement-drawings/${urlPath}`;
    const derivativeWidth = parseDerivativeWidth((request.query as { w?: string }).w);

    try {
      if (derivativeWidth) {
        const { buffer, contentType, stat } = await PartMeasurementDrawingStorage.readDrawingDerivative(
          drawingUrl,
          derivativeWidth
        );
        const etag = buildPdfPageEtag(stat);
        reply.header('ETag', etag);
        reply.header('Cache-Control', PART_MEASUREMENT_DRAWING_CACHE_CONTROL);

        if (ifNoneMatchSatisfied(request.headers['if-none-match'], etag)) {
          return reply.code(304).send();
        }

        reply.type(contentType);
        return reply.send(buffer);
      }

      const stat = await PartMeasurementDrawingStorage.statDrawing(drawingUrl);
      const etag = buildPdfPageEtag(stat);
      reply.header('ETag', etag);
      reply.header('Cache-Control', PART_MEASUREMENT_DRAWING_CACHE_CONTROL);

      if (ifNoneMatchSatisfied(request.headers['if-none-match'], etag)) {
        return reply.code(304).send();
      }

      const { buffer, contentType } = await PartMeasurementDrawingStorage.readDrawing(drawingUrl);
      reply.type(contentType);
      return reply.send(buffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: '図面が見つかりません' });
      }
      request.log.error({ err, drawingUrl }, '図面の読み込みに失敗しました');
      return reply.status(500).send({ message: '図面の読み込みに失敗しました' });
    }
  });
}
