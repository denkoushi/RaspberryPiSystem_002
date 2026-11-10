import { sendStorageReadError } from './shared.js';
import { createDeviceReadRateLimit } from '../../lib/device-read-rate-limit.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PhotoStorage } from '../../lib/photo-storage.js';
import { requireDeviceKeyOrViewer } from '../../lib/device-or-viewer.js';
import { ApiError } from '../../lib/errors.js';

/**
 * 写真配信ルート
 * 
 * 元画像をAPI経由で配信する（認証必要）。
 * JWTトークンまたはclient-keyで認証可能。
 */
export function registerPhotoStorageRoutes(app: FastifyInstance): void {

  /**
   * GET /api/storage/photos/*
   * 
   * 元画像を配信する
   * パス例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg
   */
  app.get('/storage/photos/*', { config: { rateLimit: createDeviceReadRateLimit() } }, async (request: FastifyRequest, reply: FastifyReply) => {
    await requireDeviceKeyOrViewer(request, reply);
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
      reply.header('Cache-Control', 'private, max-age=86400');
      
      // 画像データを返す
      return reply.send(imageBuffer);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const err = error instanceof Error ? error : new Error(String(error));
      return sendStorageReadError(request, reply, err, {
        notFoundMessage: '写真が見つかりません',
        failedMessage: '写真の読み込みに失敗しました',
        logContext: { err, photoUrl: `/api/storage/photos/${urlPath}` },
      });
    }
  });
}
