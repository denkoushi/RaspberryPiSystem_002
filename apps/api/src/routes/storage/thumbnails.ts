import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../../lib/errors.js';
import { PhotoStorage } from '../../lib/photo-storage.js';

export function registerThumbnailStorageRoutes(app: FastifyInstance): void {
  app.get(
    '/storage/thumbnails/*',
    { config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const relativePath = request.url.replace('/api/storage/thumbnails/', '').split('?')[0];
      if (!relativePath) {
        return reply.status(400).send({ message: 'サムネイルのパスが指定されていません' });
      }

      try {
        const buffer = await PhotoStorage.readThumbnail(relativePath);
        reply.header('Cache-Control', 'public, max-age=86400');
        reply.type('image/jpeg');
        return reply.send(buffer);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.status(404).send({ message: 'サムネイルが見つかりません' });
        }
        request.log.error({ err: error }, 'サムネイルの読み込みに失敗しました');
        return reply.status(500).send({ message: 'サムネイルの読み込みに失敗しました' });
      }
    }
  );
}
