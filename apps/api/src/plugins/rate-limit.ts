import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * レート制限プラグインを登録
 * 一般APIエンドポイント用のデフォルトレート制限を適用
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // 一般APIエンドポイント用のレート制限（デフォルト）
  await app.register(rateLimit, {
    max: 100, // 100リクエスト
    timeWindow: '1 minute', // 1分間
    skipOnError: false,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    // IPアドレスベースのレート制限
    keyGenerator: (request) => {
      return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
        ? request.headers['x-forwarded-for'][0]
        : request.headers['x-forwarded-for']) || 'unknown';
    },
    // キオスク画面用のエンドポイントはレート制限を緩和（2秒ごとのポーリングに対応）
    skip: (request: FastifyRequest) => {
      // キオスク画面からのリクエスト（x-client-keyヘッダーがある場合）はレート制限をスキップ
      const url = request.url;
      const hasClientKey = !!request.headers['x-client-key'];
      
      // キオスク画面用のエンドポイント
      const kioskEndpoints = [
        '/api/tools/loans/active',
        '/api/tools/loans/borrow',
        '/api/tools/loans/return',
      ];
      
      return (
        (kioskEndpoints.some(endpoint => url.startsWith(endpoint)) && hasClientKey) ||
        url.startsWith('/api/kiosk/config')
      );
    },
  });
}

/**
 * 認証エンドポイント用の厳しいレート制限設定
 * ブルートフォース攻撃対策として使用
 */
export const authRateLimitConfig = {
  max: 5, // 5リクエスト
  timeWindow: '1 minute', // 1分間
  skipOnError: false,
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  keyGenerator: (request: any) => {
    return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
      ? request.headers['x-forwarded-for'][0]
      : request.headers['x-forwarded-for']) || 'unknown';
  },
};

