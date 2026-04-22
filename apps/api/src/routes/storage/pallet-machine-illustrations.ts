import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PalletMachineIllustrationStorage } from '../../lib/pallet-machine-illustration-storage.js';

/**
 * GET /api/storage/pallet-machine-illustrations/*
 * 加工機イラスト配信。公開読み取り（ファイル名は UUID、パス推測困難）。
 * `<img src>` やサイネージ画像取得で Authorization / x-client-key を付けられないため認可しない。
 */
export function registerPalletMachineIllustrationStorageRoutes(app: FastifyInstance): void {
  app.get('/storage/pallet-machine-illustrations/*', { config: { rateLimit: false } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = decodeURIComponent(((request.params as { '*': string | undefined })['*']) ?? '');
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
