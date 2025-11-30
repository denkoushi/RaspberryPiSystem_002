import type { FastifyInstance } from 'fastify';
import { SignageService } from '../../services/signage/index.js';

export function registerContentRoute(app: FastifyInstance, signageService: SignageService): void {
  // GET /api/signage/content - 現在時刻に基づいて表示すべきコンテンツを取得（認証不要、サイネージ用）
  app.get('/content', { config: { rateLimit: false } }, async () => {
    const content = await signageService.getContent();
    return content;
  });
}

