import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

type CallTargetsRouteDeps = {
  normalizeClientKey: (rawKey: unknown) => string | undefined;
  getWebRTCCallExcludeClientIds: () => Set<string>;
};

export async function registerKioskCallTargetsRoute(
  app: FastifyInstance,
  deps: CallTargetsRouteDeps
): Promise<void> {
  /**
   * キオスク通話向けの発信先一覧
   * - x-client-key 認証のみ（管理ユーザーのJWTは不要）
   * - 通話IDは ClientDevice.id を使用
   * - ClientStatus は補助情報として利用
   */
  app.get('/kiosk/call/targets', { config: { rateLimit: false } }, async (request) => {
    const clientKey = deps.normalizeClientKey(request.headers['x-client-key']);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const selfDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });
    if (!selfDevice) {
      throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
    }

    const statuses = await prisma.clientStatus.findMany({
      orderBy: { hostname: 'asc' }
    });
    const statusByClientId = new Map(statuses.map((status) => [status.clientId, status]));

    const devices = await prisma.clientDevice.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        location: true,
        statusClientId: true,
        lastSeenAt: true,
        updatedAt: true
      }
    });

    // 既存の /clients/status と同じ閾値（12時間）
    const staleThresholdMs = 1000 * 60 * 60 * 12;
    const now = Date.now();
    const selfClientId = selfDevice.id;

    const excludedClientIds = deps.getWebRTCCallExcludeClientIds();
    return {
      selfClientId,
      targets: devices
        .map((device) => {
          const status = device.statusClientId ? statusByClientId.get(device.statusClientId) : undefined;
          const lastSeen = device.lastSeenAt ?? status?.lastSeen ?? status?.updatedAt ?? device.updatedAt;
          const stale = now - lastSeen.getTime() > staleThresholdMs;
          return {
            clientId: device.id,
            hostname: status?.hostname ?? device.name,
            ipAddress: status?.ipAddress ?? 'unknown',
            lastSeen,
            stale,
            name: device.name,
            location: device.location ?? null
          };
        })
        .filter((t) => t.clientId !== selfClientId)
        .filter((t) => !excludedClientIds.has(t.clientId))
    };
  });
}
