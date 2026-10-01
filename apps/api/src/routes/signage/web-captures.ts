import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import {
  getSignageWebCaptureService,
  type SignageWebCaptureService,
} from '../../services/signage/web-capture/signage-web-capture.service.js';
import {
  webCaptureParamsSchema,
  webCaptureSchema,
  webCapturePreviewSchema,
  webCaptureUpdateSchema,
} from './schemas.js';

/**
 * ページ撮影コンテンツ（管理Webのページを撮ってサイネージに出す）の管理API。
 * 画像は管理画面内のデータを含むため、取得も管理権限に限定する。
 */
export function registerWebCaptureRoutes(
  app: FastifyInstance,
  service: SignageWebCaptureService = getSignageWebCaptureService(),
): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/web-captures', { preHandler: canManage }, async () => {
    return { webCaptures: await service.list() };
  });

  app.post('/web-captures', { preHandler: canManage }, async (request) => {
    const body = webCaptureSchema.parse(request.body);
    return { webCapture: await service.create(body) };
  });

  // 保存前の設定で撮影し、プレビュー画像（data URL）と「隠す部分」の候補を返す
  app.post('/web-captures/capture-preview', { preHandler: canManage }, async (request) => {
    const { autoHideLandmarks, ...settings } = webCapturePreviewSchema.parse(request.body);
    const result = await service.captureOnce(settings, { autoHideLandmarks });
    return {
      imageDataUrl: `data:image/jpeg;base64,${result.jpeg.toString('base64')}`,
      regions: result.regions,
      durationMs: result.durationMs,
      autoHiddenSelectors: result.autoHiddenSelectors,
      pageTitle: result.pageTitle,
    };
  });

  app.put('/web-captures/:id', { preHandler: canManage }, async (request) => {
    const params = webCaptureParamsSchema.parse(request.params);
    const body = webCaptureUpdateSchema.parse(request.body);
    return { webCapture: await service.update(params.id, body) };
  });

  app.delete('/web-captures/:id', { preHandler: canManage }, async (request) => {
    const params = webCaptureParamsSchema.parse(request.params);
    await service.delete(params.id);
    return { success: true };
  });

  // 今すぐ撮影して保存する。失敗は lastStatus / lastError に入る。
  app.post('/web-captures/:id/capture', { preHandler: canManage }, async (request) => {
    const params = webCaptureParamsSchema.parse(request.params);
    return { webCapture: await service.captureAndStore(params.id) };
  });

  app.get('/web-captures/:id/image', { preHandler: canManage }, async (request, reply) => {
    const params = webCaptureParamsSchema.parse(request.params);
    await service.get(params.id);
    const image = await service.readImage(params.id);
    if (!image) throw new ApiError(404, 'まだ撮影されていません', undefined, 'SIGNAGE_WEB_CAPTURE_NO_IMAGE');
    return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(image);
  });
}
