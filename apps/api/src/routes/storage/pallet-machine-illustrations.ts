import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { PalletMachineIllustrationStorage } from '../../lib/pallet-machine-illustration-storage.js';

/**
 * GET /api/storage/pallet-machine-illustrations/*
 * 加工機イラスト配信。JWT または有効な x-client-key。
 */
export function registerPalletMachineIllustrationStorageRoutes(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/storage/pallet-machine-illustrations/*', { config: { rateLimit: false } }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    const urlPath = request.url.replace('/api/storage/pallet-machine-illustrations/', '');
    if (!urlPath) {
      return reply.status(400).send({ message: 'イラストのパスが指定されていません' });
    }

    const illustrationUrl = `/api/storage/pallet-machine-illustrations/${urlPath}`;

    try {
      const { buffer, contentType } = await PalletMachineIllustrationStorage.readIllustration(illustrationUrl);
      reply.type(contentType);
      return reply.send(buffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: 'イラストが見つかりません' });
      }
      request.log.error({ err, illustrationUrl }, 'イラストの読み込みに失敗しました');
      return reply.status(500).send({ message: 'イラストの読み込みに失敗しました' });
    }
  });
}
