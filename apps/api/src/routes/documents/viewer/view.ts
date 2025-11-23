import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { documentViewSchema } from './schemas.js';
// import { DocumentViewerService } from '../../../services/documents/viewer.service.js';

/**
 * ドキュメント閲覧ルート
 * 将来の実装時に使用
 */
export function registerDocumentViewRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  
  app.get('/documents/:documentId/view', { preHandler: canView }, async (request) => {
    const params = documentViewSchema.parse(request.params);
    // TODO: DocumentViewerServiceを実装後に有効化
    // const viewerService = new DocumentViewerService();
    // const result = await viewerService.getViewData(params.documentId, params.page);
    // return result;
    
    // プレースホルダー
    return { documentId: params.documentId, content: null };
  });
}

