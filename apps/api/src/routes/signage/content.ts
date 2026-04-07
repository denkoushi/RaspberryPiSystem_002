import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SignageService } from '../../services/signage/index.js';

function resolveClientKeyFromRequest(request: FastifyRequest): string | null {
  const headerKey = request.headers['x-client-key'];
  const fromHeader =
    typeof headerKey === 'string' ? headerKey : headerKey?.[0] != null ? String(headerKey[0]) : null;
  const q = request.query;
  const fromQuery =
    typeof q === 'object' && q !== null && 'clientKey' in q && q.clientKey != null && q.clientKey !== ''
      ? String(q.clientKey)
      : null;
  return fromQuery ?? fromHeader ?? null;
}

export function registerContentRoute(app: FastifyInstance, signageService: SignageService): void {
  // GET /api/signage/content - 現在時刻に基づいて表示すべきコンテンツを取得（認証不要、サイネージ用）
  app.get('/content', { config: { rateLimit: false } }, async (request: FastifyRequest) => {
    const clientKey = resolveClientKeyFromRequest(request);
    const content = await signageService.getContent({ clientKey });
    return content;
  });
}

