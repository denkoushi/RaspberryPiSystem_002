import type { FastifyInstance } from 'fastify';
import { registerDocumentListRoute } from './list.js';

/**
 * ドキュメントファイル管理ルートの登録
 * 将来の実装時に使用
 */
export function registerDocumentFileRoutes(app: FastifyInstance): void {
  registerDocumentListRoute(app);
  // TODO: 他のルート（create, get, delete等）を追加
}

