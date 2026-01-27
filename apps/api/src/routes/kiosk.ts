import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { sendSlackNotification } from '../services/notifications/slack-webhook.js';

const PRODUCTION_SCHEDULE_DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const COMPLETED_PROGRESS_VALUE = '完了';

const normalizeClientKey = (rawKey: unknown): string | undefined => {
  if (typeof rawKey === 'string') {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // noop
    }
    return rawKey;
  }
  if (Array.isArray(rawKey) && rawKey.length > 0 && typeof rawKey[0] === 'string') {
    return rawKey[0];
  }
  return undefined;
};

const supportMessageSchema = z.object({
  message: z.string().min(1).max(1000),
  page: z.string().min(1).max(200)
});

// シンプルなメモリベースのレート制限（1分に最大3件）
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1分
const RATE_LIMIT_MAX_REQUESTS = 3;

function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const requests = rateLimitMap.get(clientKey) || [];
  
  // 古いリクエストを削除
  const recentRequests = requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false; // レート制限超過
  }
  
  recentRequests.push(now);
  rateLimitMap.set(clientKey, recentRequests);
  
  // メモリリーク防止: 5分以上古いエントリを削除
  if (rateLimitMap.size > 100) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const filtered = timestamps.filter((ts) => now - ts < 5 * 60 * 1000);
      if (filtered.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, filtered);
      }
    }
  }
  
  return true;
}

export async function registerKioskRoutes(app: FastifyInstance): Promise<void> {
  const productionScheduleQuerySchema = z.object({
    productNo: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(2000).optional(),
  });

  const productionScheduleCompleteParamsSchema = z.object({
    rowId: z.string().uuid(),
  });

  const requireClientDevice = async (rawClientKey: unknown) => {
    const clientKey = normalizeClientKey(rawClientKey);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const clientDevice = await prisma.clientDevice.findUnique({
      where: { apiKey: clientKey },
    });
    if (!clientDevice) {
      throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
    }
    return { clientKey, clientDevice };
  };

  // キオスク専用の従業員リスト取得エンドポイント（x-client-key認証のみ）
  app.get('/kiosk/employees', { config: { rateLimit: false } }, async (request) => {
    const rawClientKey = request.headers['x-client-key'];
    await requireClientDevice(rawClientKey);

    // アクティブな従業員のみを取得（基本情報のみ）
    const employees = await prisma.employee.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        displayName: true,
        department: true
      },
      orderBy: {
        displayName: 'asc'
      }
    });

    return { employees };
  });

  // 生産日程（研削工程）: 仕掛中のみ取得（x-client-key認証のみ）
  app.get('/kiosk/production-schedule', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);

    const query = productionScheduleQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 400;
    const productNoFilter = query.productNo?.trim();

    const productNoLike = productNoFilter ? `%${productNoFilter}%` : null;
    const baseWhere = Prisma.sql`"csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}`;
    const productNoWhere = productNoLike
      ? Prisma.sql`AND ("rowData"->>'ProductNo') ILIKE ${productNoLike}`
      : Prisma.empty;

    const countRows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS total
      FROM "CsvDashboardRow"
      WHERE ${baseWhere} ${productNoWhere}
    `;
    const total = Number(countRows[0]?.total ?? 0n);

    const offset = (page - 1) * pageSize;
    const rows = await prisma.$queryRaw<
      Array<{ id: string; occurredAt: Date; rowData: Prisma.JsonValue }>
    >`
      SELECT id, "occurredAt", "rowData"
      FROM "CsvDashboardRow"
      WHERE ${baseWhere} ${productNoWhere}
      ORDER BY
        ("rowData"->>'FSEIBAN') ASC,
        ("rowData"->>'ProductNo') ASC,
        (CASE
          WHEN ("rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("rowData"->>'FKOJUN'))::int
          ELSE NULL
        END) ASC,
        ("rowData"->>'FHINCD') ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return {
      page,
      pageSize,
      total,
      rows,
    };
  });

  // 生産日程（研削工程）: 完了にする（x-client-key認証のみ）
  app.put('/kiosk/production-schedule/:rowId/complete', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const params = productionScheduleCompleteParamsSchema.parse(request.params);

    const row = await prisma.csvDashboardRow.findFirst({
      where: { id: params.rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, rowData: true },
    });
    if (!row) {
      throw new ApiError(404, '対象の行が見つかりません');
    }

    const current = row.rowData as Record<string, unknown>;
    const currentProgress = typeof current.progress === 'string' ? current.progress.trim() : '';
    
    // トグル動作: 既に完了している場合は未完了に戻す
    const nextRowData: Record<string, unknown> = {
      ...current,
      progress: currentProgress === COMPLETED_PROGRESS_VALUE ? '' : COMPLETED_PROGRESS_VALUE,
    };

    await prisma.csvDashboardRow.update({
      where: { id: row.id },
      data: { rowData: nextRowData as Prisma.InputJsonValue },
    });

    return { success: true, alreadyCompleted: false, rowData: nextRowData };
  });

  app.get('/kiosk/config', { config: { rateLimit: false } }, async (request) => {
    // クライアントキーからクライアント端末を特定
    const rawClientKey = request.headers['x-client-key'];
    // ヘッダーが文字列配列の場合や、JSON文字列化されている場合に対応
    let clientKey: string | undefined;
    if (typeof rawClientKey === 'string') {
      // JSON文字列化されている場合（"client-demo-key"）をパース
      try {
        const parsed = JSON.parse(rawClientKey);
        clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
      } catch {
        clientKey = rawClientKey;
      }
    } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
      clientKey = rawClientKey[0];
    }
    
    // 機密情報保護: x-client-keyをログから除外
    const sanitizedHeaders = { ...request.headers };
    if ('x-client-key' in sanitizedHeaders) {
      sanitizedHeaders['x-client-key'] = '[REDACTED]';
    }
    app.log.info({ 
      clientKey: clientKey ? '[REDACTED]' : undefined, 
      rawClientKey: '[REDACTED]', 
      headers: sanitizedHeaders 
    }, 'Kiosk config request');
    let defaultMode: 'PHOTO' | 'TAG' = 'TAG'; // デフォルトはTAG
    let clientStatus: {
      temperature: number | null;
      cpuUsage: number;
      lastSeen: Date;
    } | null = null;

    if (clientKey) {
      const client = await prisma.clientDevice.findUnique({
        where: { apiKey: clientKey }
      });
      // 機密情報保護: clientKeyとclient.apiKeyをログから除外
      const sanitizedClient = client ? { ...client, apiKey: '[REDACTED]' } : null;
      app.log.info({ 
        client: sanitizedClient, 
        clientKey: '[REDACTED]', 
        found: !!client, 
        defaultMode: client?.defaultMode 
      }, 'Client device lookup result');
      if (client?.defaultMode) {
        defaultMode = client.defaultMode as 'PHOTO' | 'TAG';
      }

      // statusClientId で ClientStatus を取得（自端末の温度・CPU負荷を返す）
      const statusClientId = (client as { statusClientId?: string | null } | null)?.statusClientId;
      if (statusClientId) {
        const status = await prisma.clientStatus.findUnique({
          where: { clientId: statusClientId }
        });
        if (status) {
          clientStatus = {
            temperature: status.temperature,
            cpuUsage: status.cpuUsage,
            lastSeen: status.lastSeen
          };
        }
      }
    }

    // 機密情報保護: clientKeyをログから除外
    app.log.info({ 
      defaultMode, 
      clientKey: '[REDACTED]', 
      hasClientStatus: !!clientStatus 
    }, 'Returning kiosk config');
    return {
      theme: 'factory-dark',
      greeting: 'タグを順番にかざしてください',
      idleTimeoutMs: 30000,
      defaultMode,
      clientStatus
    };
  });

  /**
   * キオスク通話向けの発信先一覧
   * - x-client-key 認証のみ（管理ユーザーのJWTは不要）
   * - ClientStatus(clientId) と ClientDevice(statusClientId) を突き合わせて location を付与
   */
  app.get('/kiosk/call/targets', { config: { rateLimit: false } }, async (request) => {
    const clientKey = normalizeClientKey(request.headers['x-client-key']);
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
    const statusClientIds = statuses.map((s) => s.clientId);

    const deviceByStatusId = new Map<string, { name: string; location: string | null }>();
    if (statusClientIds.length > 0) {
      const devices = await prisma.clientDevice.findMany({
        where: { statusClientId: { in: statusClientIds } },
        select: { statusClientId: true, name: true, location: true }
      });
      for (const d of devices) {
        if (d.statusClientId) {
          deviceByStatusId.set(d.statusClientId, { name: d.name, location: d.location ?? null });
        }
      }
    }

    // 既存の /clients/status と同じ閾値（12時間）
    const staleThresholdMs = 1000 * 60 * 60 * 12;
    const now = Date.now();
    const selfClientId = selfDevice.statusClientId ?? null;

    return {
      selfClientId,
      targets: statuses
        .map((status) => {
          const lastSeen = status.lastSeen ?? status.updatedAt;
          const stale = now - lastSeen.getTime() > staleThresholdMs;
          const device = deviceByStatusId.get(status.clientId);
          return {
            clientId: status.clientId,
            hostname: status.hostname,
            ipAddress: status.ipAddress,
            lastSeen,
            stale,
            name: device?.name ?? status.hostname,
            location: device?.location ?? null
          };
        })
        .filter((t) => t.clientId !== selfClientId)
    };
  });

  app.post('/kiosk/support', { config: { rateLimit: false } }, async (request) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:224',message:'/kiosk/support endpoint called',data:{requestId:request.id,hasRawClientKey:!!request.headers['x-client-key']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    const rawClientKey = request.headers['x-client-key'];
    const clientKey = normalizeClientKey(rawClientKey);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'kiosk.ts:228',message:'clientKey normalized',data:{requestId:request.id,hasClientKey:!!clientKey,clientKeyLength:clientKey?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    // レート制限チェック
    const rateLimitPassed = checkRateLimit(clientKey);
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
