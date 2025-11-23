import type { FastifyInstance } from 'fastify';
import { registerDocumentViewRoute } from './view.js';

/**
 * ドキュメントビューワールートの登録
 * 将来の実装時に使用
 */
export function registerDocumentViewerRoutes(app: FastifyInstance): void {
  registerDocumentViewRoute(app);
  // TODO: 他のルート（download, preview等）を追加
}

