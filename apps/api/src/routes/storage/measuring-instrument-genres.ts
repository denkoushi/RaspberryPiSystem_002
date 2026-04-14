import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { MeasuringInstrumentGenreImageStorage } from '../../lib/measuring-instrument-genre-image-storage.js';

export function registerMeasuringInstrumentGenreStorageRoutes(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/storage/measuring-instrument-genres/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
      const client = await prisma.clientDevice.findUnique({ where: { apiKey } });
      if (!client) {
        await canView(request, reply);
      }
    } else {
      await canView(request, reply);
    }

    const urlPath = request.url.replace('/api/storage/measuring-instrument-genres/', '');
    if (!urlPath) {
      return reply.status(400).send({ message: '画像パスが指定されていません' });
    }

    const imageUrl = `/api/storage/measuring-instrument-genres/${urlPath}`;
    try {
      const { buffer, contentType } = await MeasuringInstrumentGenreImageStorage.read(imageUrl);
      reply.type(contentType);
      return reply.send(buffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: '画像が見つかりません' });
      }
      request.log.error({ err, imageUrl }, 'ジャンル画像の読み込みに失敗しました');
      return reply.status(500).send({ message: '画像の読み込みに失敗しました' });
    }
  });
}
