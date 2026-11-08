import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createDeviceReadRateLimit } from '../../lib/device-read-rate-limit.js';
import { requireDeviceKeyOrViewer } from '../../lib/device-or-viewer.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';
import { VisualizationImageCache } from '../../services/signage/visualization-image-cache.js';

const paramsSchema = z.object({
  id: z.string().guid(),
});

/**
 * 可視化ダッシュボードのレンダリング画像を返す（Web /signage 表示用）
 * 端末キーまたはログインが必要
 */
export function registerVisualizationImageRoute(
  app: FastifyInstance,
  signageService: SignageService
): void {
  const cache = new VisualizationImageCache();
  app.get(
    '/visualization-image/:id',
    { config: { rateLimit: createDeviceReadRateLimit() } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      await requireDeviceKeyOrViewer(request, reply);
      const { id } = paramsSchema.parse(request.params);
      const dashboard = await prisma.visualizationDashboard.findUnique({ where: { id }, select: { id: true } });
      if (!dashboard) throw new ApiError(404, '可視化が見つかりません');
      const buffer = await cache.get(id, () =>
        new SignageRenderer(signageService).renderVisualizationToBuffer(id)
      );

      reply
        .type('image/jpeg')
        .header('Cache-Control', 'private, max-age=30')
        .send(buffer);
    }
  );
}
