import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * レート制限をスキップするパスのリスト
 */
const skipPaths = [
  '/api/tools/employees',
  '/api/tools/items',
  '/api/tools/transactions',
  '/api/tools/loans/active',
  '/api/tools/loans/borrow',
  '/api/tools/loans/return',
  '/api/kiosk',
  '/api/imports',
];

/**
 * レート制限をスキップするか判定
 */
function shouldSkipRateLimit(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0]; // クエリパラメータを除去
  
  // DELETEエンドポイント（削除機能）をスキップ
  if (request.method === 'DELETE' && (
    path.startsWith('/api/tools/employees/') ||
    path.startsWith('/api/tools/items/')
  )) {
    return true;
  }
  
  // 定義されたパスをスキップ
  return skipPaths.some(skipPath => path.startsWith(skipPath));
}

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
    keyGenerator: (request: FastifyRequest) => {
      return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
        ? request.headers['x-forwarded-for'][0]
        : request.headers['x-forwarded-for']) || 'unknown';
    },
    // 特定のパスをスキップ（@fastify/rate-limitのオプションとして渡す）
    skip: shouldSkipRateLimit,
  } as Parameters<typeof rateLimit>[1]);
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
  keyGenerator: (request: FastifyRequest) => {
    return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
      ? request.headers['x-forwarded-for'][0]
      : request.headers['x-forwarded-for']) || 'unknown';
  },
};
