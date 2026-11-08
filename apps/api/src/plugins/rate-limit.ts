import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { normalizeClientKey } from '../lib/client-key.js';
import { prisma } from '../lib/prisma.js';
import { createRateLimitDeviceCache } from './rate-limit-device-cache.js';

/**
 * レート制限プラグイン
 * 
 * @fastify/rate-limitのベストプラクティスに従い:
 * - グローバルにデフォルト制限を設定
 * - keyGeneratorで端末またはIPとルート別にカウント
 * - allowListで特定パスをスキップ
 */

// スキップするパスのプレフィックス
const skipPrefixes = [
  '/api/kiosk/support',
  '/api/kiosk/power',
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

/**
 * レート制限用のパス正規化。
 * ルータはパーセントエンコードを復号してから照合するため、生のURLをキーにすると
 * `/api/auth/logi%6E` のような別表記ごとに別カウンタになり制限を回避できる。
 * クエリを除き、ルータと同じく1回だけ復号した値をキーとスキップ判定に使う。
 */
export const normalizeRateLimitPath = (url: string): string => {
  const path = url.split('?')[0] ?? '';
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

// パスがスキップ対象かどうかを判定
const shouldSkip = (path: string): boolean => {
  return skipPrefixes.some((prefix) => path.startsWith(prefix));
};

export const registerRateLimit = fp(async (app: FastifyInstance) => {
  const lookupDevice = createRateLimitDeviceCache({
    lookup: (apiKey) => prisma.clientDevice.findUnique({ where: { apiKey }, select: { id: true } })
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: async (request: FastifyRequest) => {
      const routePattern = request.routeOptions.url ?? normalizeRateLimitPath(request.url);
      const apiKey = normalizeClientKey(request.headers['x-client-key']);
      const deviceId = apiKey ? await lookupDevice(apiKey) : null;
      return deviceId ? `device:${deviceId}:${routePattern}` : `${request.ip}:${routePattern}`;
    },
    // 特定パスをスキップ
    allowList: (request: FastifyRequest) => {
      return shouldSkip(normalizeRateLimitPath(request.url));
    },
    // 429エラー時のレスポンス
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry in ${context.after}.`
    })
  });
});
