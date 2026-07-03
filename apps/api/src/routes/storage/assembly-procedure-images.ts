import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { buildPdfPageEtag, ifNoneMatchSatisfied } from './pdf-page-http-cache.js';

const ASSEMBLY_PROCEDURE_IMAGE_CACHE_CONTROL = 'private, max-age=86400, immutable';
const ASSEMBLY_PROCEDURE_IMAGE_RATE_LIMIT = { max: 240, timeWindow: '1 minute' };

export function registerAssemblyProcedureImageStorageRoutes(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get(
    '/storage/assembly-procedure-images/*',
    { config: { rateLimit: ASSEMBLY_PROCEDURE_IMAGE_RATE_LIMIT } },
    async (request: FastifyRequest, reply: FastifyReply) => {
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

      const urlPath = request.url.replace('/api/storage/assembly-procedure-images/', '');
      if (!urlPath) {
        return reply.status(400).send({ message: '手順書画像のパスが指定されていません' });
      }
      const imageUrl = `/api/storage/assembly-procedure-images/${urlPath}`;

      try {
        const stat = await AssemblyProcedureImageStorage.statImage(imageUrl);
        const etag = buildPdfPageEtag(stat);
        reply.header('ETag', etag);
        reply.header('Cache-Control', ASSEMBLY_PROCEDURE_IMAGE_CACHE_CONTROL);
        if (ifNoneMatchSatisfied(request.headers['if-none-match'], etag)) {
          return reply.code(304).send();
        }
        const { buffer, contentType } = await AssemblyProcedureImageStorage.readImage(imageUrl);
        reply.type(contentType);
        return reply.send(buffer);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.status(404).send({ message: '手順書画像が見つかりません' });
        }
        request.log.error({ err, imageUrl }, '組立手順書画像の読み込みに失敗しました');
        return reply.status(500).send({ message: '手順書画像の読み込みに失敗しました' });
      }
    }
  );
}
