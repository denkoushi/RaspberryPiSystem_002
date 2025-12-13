import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * レート制限プラグイン
 * 
 * @fastify/rate-limitのベストプラクティスに従い:
 * - グローバルにデフォルト制限を設定
 * - keyGeneratorでURL+IPをキーにしてエンドポイント別にカウント
 * - allowListで特定パスをスキップ
 */

// スキップするパスのプレフィックス
const skipPrefixes = [
  '/api/kiosk',
  '/api/tools/loans/active',
  '/api/tools/loans/borrow',
  '/api/tools/loans/return',
  '/api/tools/transactions',
  '/api/tools/employees',
  '/api/tools/items',
  '/api/imports',
  '/ws',
  '/api/signage',
  '/api/storage'
];

// パスがスキップ対象かどうかを判定
const shouldSkip = (path: string): boolean => {
  return skipPrefixes.some((prefix) => path.startsWith(prefix));
};

export const registerRateLimit = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    // URL+IPをキーにしてエンドポイント別にカウント
    keyGenerator: (request: FastifyRequest) => {
      const baseUrl = request.url.split('?')[0];
      return `${request.ip}:${baseUrl}`;
    },
    // 特定パスをスキップ
    allowList: (request: FastifyRequest) => {
      const path = request.url.split('?')[0];
      return shouldSkip(path);
    },
    // 429エラー時のレスポンス
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${context.after}.`
    })
  });
});
