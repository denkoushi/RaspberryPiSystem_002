import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { sendSlackNotification } from '../../services/notifications/slack-webhook.js';

const supportMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  page: z.string().min(1).max(200)
});

type SupportRouteDeps = {
  normalizeClientKey: (rawKey: unknown) => string | undefined;
  checkRateLimit: (clientKey: string, ip: string) => Promise<boolean>;
};

export async function registerKioskSupportRoute(
  app: FastifyInstance,
  deps: SupportRouteDeps
): Promise<void> {
  app.post('/kiosk/support', { config: { rateLimit: false } }, async (request) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:224',message:'/kiosk/support endpoint called',data:{requestId:request.id,hasRawClientKey:!!request.headers['x-client-key']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    const rawClientKey = request.headers['x-client-key'];
    const clientKey = deps.normalizeClientKey(rawClientKey);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:228',message:'clientKey normalized',data:{requestId:request.id,hasClientKey:!!clientKey,clientKeyLength:clientKey?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    // レート制限チェック
    const rateLimitPassed = await deps.checkRateLimit(clientKey, request.ip);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:235',message:'rate limit check',data:{requestId:request.id,rateLimitPassed},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
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
          location: clientDevice.location,
          userMessage: body.message
        } as Prisma.InputJsonValue
      }
    });

    // Slack通知を送信（非同期、エラーはログに記録するがAPIレスポンスには影響しない）
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:271',message:'calling sendSlackNotification',data:{requestId:request.id,clientId,clientName:clientDevice.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    sendSlackNotification({
      clientId,
      clientName: clientDevice.name,
      location: clientDevice.location || undefined,
      page: body.page,
      message: body.message,
      requestId: request.id
    }).then(() => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:278',message:'sendSlackNotification resolved',data:{requestId:request.id,clientId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    }).catch((error) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:281',message:'sendSlackNotification rejected',data:{requestId:request.id,clientId,errorName:error instanceof Error?error.name:'unknown',errorMessage:error instanceof Error?error.message:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      app.log.error(
        { err: error, requestId: request.id, clientId },
        '[KioskSupport] Failed to send Slack notification'
      );
    });

    return { requestId: request.id };
  });
}
