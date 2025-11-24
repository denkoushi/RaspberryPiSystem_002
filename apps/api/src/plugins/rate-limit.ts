import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';

/**
 * キオスクエンドポイントかどうかを判定
 */
function isKioskEndpoint(request: FastifyRequest): boolean {
  const fullUrl = request.url;
  const url = fullUrl.split('?')[0]; // クエリパラメータを除去
  const hasClientKey = !!request.headers['x-client-key'];
  
  // キオスク画面用のエンドポイント
  const kioskEndpoints = [
    '/api/tools/loans/active',
    '/api/tools/loans/borrow',
    '/api/tools/loans/return',
  ];
  
  const isKioskLoanEndpoint = kioskEndpoints.some(endpoint => url === endpoint || url.startsWith(endpoint + '/'));
  const isKioskConfig = url === '/api/kiosk/config' || url.startsWith('/api/kiosk/config/');
  
  // キオスクエンドポイントで、かつx-client-keyヘッダーがある場合、または/kiosk/configの場合
  return (isKioskLoanEndpoint && hasClientKey) || isKioskConfig;
}

/**
 * レート制限プラグインを登録
 * 一般APIエンドポイント用のデフォルトレート制限を適用
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // 一般APIエンドポイント用のレート制限（デフォルト）
  const rateLimitOptions: RateLimitPluginOptions & {
    skip?: (request: FastifyRequest) => boolean;
  } = {
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
    // キオスク画面用のエンドポイントはレート制限をスキップ（2秒ごとのポーリングに対応）
    skip: (request: FastifyRequest) => {
      const shouldSkip = isKioskEndpoint(request);
      
      if (shouldSkip) {
        request.log.info({
          url: request.url,
          path: request.url.split('?')[0],
          hasClientKey: !!request.headers['x-client-key'],
          method: request.method,
        }, 'Rate limit skipped for kiosk endpoint');
      }
      
      return shouldSkip;
    },
  };

  await app.register(rateLimit, rateLimitOptions);
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

