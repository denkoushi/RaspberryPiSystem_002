import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { emitDebugEvent } from '../../lib/debug-sink.js';
import { sendSlackNotification } from '../../services/notifications/slack-webhook.js';
import type { ClientDeviceForScopeResolution, LocationScopeContext } from './shared.js';

const supportMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  page: z.string().min(1).max(200)
});

type SupportRouteDeps = {
  normalizeClientKey: (rawKey: unknown) => string | undefined;
  checkRateLimit: (clientKey: string, ip: string) => Promise<boolean>;
  resolveLocationScopeContext: (clientDevice: ClientDeviceForScopeResolution) => LocationScopeContext;
};

export async function registerKioskSupportRoute(
  app: FastifyInstance,
  deps: SupportRouteDeps
): Promise<void> {
  app.post('/kiosk/support', { config: { rateLimit: false } }, async (request) => {
    // #region agent log
    void emitDebugEvent({ location: 'kiosk.ts:224', message: '/kiosk/support endpoint called', data: { requestId: request.id, hasRawClientKey: !!request.headers['x-client-key'] }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' });
    // #endregion
    const rawClientKey = request.headers['x-client-key'];
    const clientKey = deps.normalizeClientKey(rawClientKey);

    // #region agent log
    void emitDebugEvent({ location: 'kiosk.ts:228', message: 'clientKey normalized', data: { requestId: request.id, hasClientKey: !!clientKey, clientKeyLength: clientKey?.length || 0 }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' });
    // #endregion

    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    // レート制限チェック
    const rateLimitPassed = await deps.checkRateLimit(clientKey, request.ip);
    // #region agent log
    void emitDebugEvent({ location: 'kiosk.ts:235', message: 'rate limit check', data: { requestId: request.id, rateLimitPassed }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' });
    // #endregion
    if (!rateLimitPassed) {
      throw new ApiError(429, 'リクエストが多すぎます。しばらく待ってから再度お試しください。', undefined, 'RATE_LIMIT_EXCEEDED');
    }

    const body = supportMessageSchema.parse(request.body);

    // クライアントデバイスを取得
    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey }
    });

    if (!clientDevice) {
      throw new ApiError(401, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
    }
    const locationScopeContext = deps.resolveLocationScopeContext(clientDevice);
    const actorLocation = locationScopeContext.deviceScopeKey;

    // clientIdはリクエストボディから取得（なければclientDevice.idを使用）
    const clientId = (request.body as { clientId?: string })?.clientId || clientDevice.id;

    // クライアントログとして保存
    const logMessage = `[SUPPORT] ${body.message}`;
    await prisma.clientLog.create({
      data: {
        clientId,
        level: 'INFO',
        message: logMessage.slice(0, 1000),
        context: {
          kind: 'kiosk-support',
          page: body.page,
          clientId,
          clientDeviceId: clientDevice.id,
          clientName: clientDevice.name,
          location: actorLocation,
          userMessage: body.message
        } as Prisma.InputJsonValue
      }
    });

    // Slack通知を送信（非同期、エラーはログに記録するがAPIレスポンスには影響しない）
    // #region agent log
    void emitDebugEvent({ location: 'kiosk.ts:271', message: 'calling sendSlackNotification', data: { requestId: request.id, clientId, clientName: clientDevice.name }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' });
    // #endregion
    sendSlackNotification({
      clientId,
      clientName: clientDevice.name,
      location: actorLocation,
      page: body.page,
      message: body.message,
      requestId: request.id
    }).then(() => {
      // #region agent log
      void emitDebugEvent({ location: 'kiosk.ts:278', message: 'sendSlackNotification resolved', data: { requestId: request.id, clientId }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' });
      // #endregion
    }).catch((error) => {
      // #region agent log
      void emitDebugEvent({ location: 'kiosk.ts:281', message: 'sendSlackNotification rejected', data: { requestId: request.id, clientId, errorName: error instanceof Error ? error.name : 'unknown', errorMessage: error instanceof Error ? error.message : String(error) }, sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' });
      // #endregion
      app.log.error(
        { err: error, requestId: request.id, clientId },
        '[KioskSupport] Failed to send Slack notification'
      );
    });

    return { requestId: request.id };
  });
}
