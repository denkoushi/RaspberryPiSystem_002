import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { documentQuerySchema } from './schemas.js';
// import { DocumentService } from '../../../services/documents/document.service.js';

/**
 * ドキュメント一覧取得ルート
 * 将来の実装時に使用
 */
export function registerDocumentListRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  
  app.get('/documents', { preHandler: canView }, async (request) => {
    const query = documentQuerySchema.parse(request.query);
    // TODO: DocumentServiceを実装後に有効化
    // const documentService = new DocumentService();
    // const result = await documentService.findAll(query);
    // return result;
    
    // プレースホルダー
    return { documents: [], total: 0, page: query.page, pageSize: query.pageSize };
  });
}

