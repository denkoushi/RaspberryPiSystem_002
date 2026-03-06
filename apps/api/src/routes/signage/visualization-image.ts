import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * 可視化ダッシュボードのレンダリング画像を返す（Web /signage 表示用）
 * 認証不要（サイネージ表示と同様）
 */
export function registerVisualizationImageRoute(
  app: FastifyInstance,
  signageService: SignageService
): void {
  app.get(
    '/visualization-image/:id',
    { config: { rateLimit: false } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const renderer = new SignageRenderer(signageService);

      const buffer = await renderer.renderVisualizationToBuffer(id);

      reply
        .type('image/jpeg')
        .header('Cache-Control', 'public, max-age=30')
        .send(buffer);
    }
  );
}
