import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { ApiError } from '../../lib/errors.js';

export function registerRenderRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const renderer = new SignageRenderer(signageService);

  app.post('/render', { preHandler: canManage }, async () => {
    const result = await renderer.renderCurrentContent();
    return { renderedAt: result.renderedAt, filename: result.filename };
  });

  app.get('/current-image', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerKey = request.headers['x-client-key'];
    if (!headerKey) {
      await canView(request, reply);
    } else {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: typeof headerKey === 'string' ? headerKey : headerKey[0] }
      });
      if (!client) {
        throw new ApiError(401, 'クライアント API キーが不正です');
      }
    }

    const imageBuffer = await SignageRenderStorage.readCurrentImage();
    if (!imageBuffer) {
      return reply.status(404).send({ message: 'レンダリング済みの画像がありません' });
    }

    reply
      .type('image/jpeg')
      .header('Cache-Control', 'no-store')
      .header('Content-Length', imageBuffer.length);

    return reply.send(imageBuffer);
  });
}

