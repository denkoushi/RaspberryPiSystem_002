import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/**
 * レート制限プラグインを登録
 * 
 * 注意: 429エラーを防ぐため、レート制限の値を非常に大きく設定しています。
 * これにより、実質的にレート制限が無効になります。
 * 
 * ルートの`config: { rateLimit: false }`は、サブルーターの場合は認識されない可能性があるため、
 * レート制限の値を非常に大きく設定することで、実質的に無効化しています。
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // レート制限を実質的に無効化（429エラーを防ぐため）
  await app.register(rateLimit, {
    max: 100000, // 非常に大きな値（実質的に無制限）
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
  keyGenerator: (request: FastifyRequest) => {
    return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
      ? request.headers['x-forwarded-for'][0]
      : request.headers['x-forwarded-for']) || 'unknown';
  },
};
