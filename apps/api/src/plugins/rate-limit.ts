import type { FastifyInstance } from 'fastify';
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
    skip: (request) => {
      // /api/tools/loans/active エンドポイントで x-client-key ヘッダーがある場合はレート制限をスキップ
      // キオスク画面からのリクエストは頻繁なポーリングが必要なため
      return (
        request.url.startsWith('/api/tools/loans/active') &&
        !!request.headers['x-client-key']
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

