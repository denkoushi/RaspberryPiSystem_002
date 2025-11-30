import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PhotoStorage } from '../../lib/photo-storage.js';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

/**
 * 写真配信ルート
 * 
 * 元画像をAPI経由で配信する（認証必要）。
 * サムネイルはCaddyで静的ファイル配信されるため、このAPIでは元画像のみを扱う。
 * JWTトークンまたはclient-keyで認証可能。
 */
export function registerPhotoStorageRoutes(app: FastifyInstance): void {
  // 認証が必要（JWTトークンまたはAPIキー）
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  /**
   * GET /api/storage/photos/*
   * 
   * 元画像を配信する
   * パス例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg
   */
  app.get('/storage/photos/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      // client-key が提供されている場合は優先的に検証し、無効な場合はJWTにフォールバック
      const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;
      const client = await prisma.clientDevice.findUnique({ where: { apiKey } });
      if (!client) {
        await canView(request, reply);
      }
    } else {
      await canView(request, reply);
    }
    // Fastifyのワイルドカードパスは request.url から抽出する
    const urlPath = request.url.replace('/api/storage/photos/', '');
    
    if (!urlPath) {
      return reply.status(400).send({ message: '写真のパスが指定されていません' });
    }

    try {
      // URLパスを構築
      const photoUrl = `/api/storage/photos/${urlPath}`;
      
      // 写真ファイルを読み込む
      const imageBuffer = await PhotoStorage.readPhoto(photoUrl);

      // Content-Typeを設定
      reply.type('image/jpeg');
      
      // 画像データを返す
      return reply.send(imageBuffer);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // ファイルが存在しない場合
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ message: '写真が見つかりません' });
      }

      request.log.error({ err, photoUrl: `/api/storage/photos/${urlPath}` }, '写真の読み込みに失敗しました');
      return reply.status(500).send({ message: '写真の読み込みに失敗しました' });
    }
  });
}

