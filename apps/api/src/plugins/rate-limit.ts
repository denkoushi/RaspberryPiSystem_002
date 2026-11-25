import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { normalizeClientKey } from '../lib/client-key.js';
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

// 端末(登録キーが無ければ接続元)ごと・経路ごとに数えるキー。端末を引くキャッシュは呼び出し側が持つ
export const createRateLimitKeyGenerator = (
  lookupDevice: (apiKey: string, sourceKey: string) => Promise<string | null>
) => async (request: FastifyRequest): Promise<string> => {
  const routePattern = request.routeOptions.url ?? normalizeRateLimitPath(request.url);
  const apiKey = normalizeClientKey(request.headers['x-client-key']);
  const deviceId = apiKey ? await lookupDevice(apiKey, request.ip) : null;
  return deviceId ? `device:${deviceId}:${routePattern}` : `${request.ip}:${routePattern}`;
};

export const registerRateLimit = fp(async (app: FastifyInstance) => {
  const lookupDevice = createRateLimitDeviceCache({
    // Loaded on first use so importing this plugin does not open a DB pool.
    lookup: async (apiKey) => (await import('../lib/prisma.js')).prisma.clientDevice.findUnique({ where: { apiKey }, select: { id: true } })
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: createRateLimitKeyGenerator(lookupDevice),
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
