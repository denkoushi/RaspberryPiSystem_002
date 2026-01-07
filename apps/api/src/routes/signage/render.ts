import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { SignageRenderer } from '../../services/signage/signage.renderer.js';
import { SignageService } from '../../services/signage/index.js';
import { SignageRenderStorage } from '../../lib/signage-render-storage.js';
import { ApiError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export function registerRenderRoutes(app: FastifyInstance, signageService: SignageService): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const renderer = new SignageRenderer(signageService);

  app.post('/render', { preHandler: canManage }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await renderer.renderCurrentContent();
      return reply.status(200).send({ renderedAt: result.renderedAt, filename: result.filename });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to render signage content');
      throw new ApiError(500, 'Failed to render signage content');
    }
  });

  app.get('/render/status', async (request: FastifyRequest, reply: FastifyReply) => {
    // クライアントキー認証をサポート
    const headerKey = request.headers['x-client-key'];
    if (!headerKey) {
      // クライアントキーがない場合はJWT認証を要求
      await canView(request, reply);
    } else {
      // クライアントキーがある場合は検証
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: typeof headerKey === 'string' ? headerKey : headerKey[0] }
      });
      if (!client) {
        throw new ApiError(401, 'クライアント API キーが不正です');
      }
    }

    const scheduler = app.signageRenderScheduler;
    return reply.status(200).send({
      isRunning: scheduler.isRunning(),
      intervalSeconds: env.SIGNAGE_RENDER_INTERVAL_SECONDS,
    });
  });

  app.get('/current-image', async (request: FastifyRequest, reply: FastifyReply) => {
    const fetchStartTime = Date.now();
    // #region agent log
    logger.info({ location: 'signage/render.ts:48', hypothesisId: 'G', fetchStartTime, clientKey: request.headers['x-client-key'] }, 'Pi3 image fetch started');
    // #endregion
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

    let imageBuffer = await SignageRenderStorage.readCurrentImage();
    // #region agent log
    const readTime = Date.now() - fetchStartTime;
    logger.info({ location: 'signage/render.ts:61', hypothesisId: 'G', hasImage: !!imageBuffer, imageSize: imageBuffer?.length, readTime }, 'Image read from storage');
    // #endregion
    if (!imageBuffer) {
      // 画像が存在しない場合はデフォルトメッセージを生成
      imageBuffer = await renderer.renderMessage('表示するコンテンツがありません');
    }

    reply
      .type('image/jpeg')
      .header('Cache-Control', 'no-store')
      .header('Content-Length', imageBuffer.length);

    // #region agent log
    const totalFetchTime = Date.now() - fetchStartTime;
    logger.info({ location: 'signage/render.ts:72', hypothesisId: 'G', imageSize: imageBuffer.length, totalFetchTime, readTime }, 'Pi3 image fetch completed');
    // #endregion
    return reply.send(imageBuffer);
  });
}

