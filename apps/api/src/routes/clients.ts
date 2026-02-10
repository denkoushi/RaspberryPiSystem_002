import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';

const heartbeatSchema = z.object({
  apiKey: z.string().min(8),
  name: z.string().min(1),
  location: z.string().optional().nullable()
});

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

const metricSchema = z.object({
  clientId: z.string().min(1),
  hostname: z.string().min(1),
  ipAddress: z.string().min(3),
  cpuUsage: z.number().min(0).max(100),
  memoryUsage: z.number().min(0).max(100),
  diskUsage: z.number().min(0).max(100),
  temperature: z.number().min(-50).max(120).optional(),
  uptimeSeconds: z.number().int().min(0).optional(),
  lastBoot: z.coerce.date().optional(),
  logs: z
    .array(
      z.object({
        level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
        message: z.string().min(1).max(1000),
        context: z.record(z.unknown()).optional()
      })
    )
    .max(20)
    .optional()
});

const logsPayloadSchema = z.object({
  clientId: z.string().min(1),
  logs: z
    .array(
      z.object({
        level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
        message: z.string().min(1).max(1000),
        context: z.record(z.unknown()).optional()
      })
    )
    .min(1)
    .max(50)
});

const logListQuerySchema = z.object({
  clientId: z.string().min(1).optional(),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.coerce.date().optional()
});

const staleThresholdMs = 1000 * 60 * 60 * 12; // 12 hours
const clientDisplayNameSchema = z
  .string()
  .max(100)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'name is required');

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');
  const canViewStatus = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.post('/clients/heartbeat', async (request) => {
    const body = heartbeatSchema.parse(request.body);

    const client = await prisma.clientDevice.upsert({
      where: { apiKey: body.apiKey },
      update: {
        location: body.location ?? undefined,
        lastSeenAt: new Date()
      },
      create: {
        name: body.name,
        location: body.location ?? undefined,
        apiKey: body.apiKey,
        lastSeenAt: new Date()
      }
    });

    return { client };
  });

  app.get('/clients', { preHandler: canManage }, async () => {
    const clients = await prisma.clientDevice.findMany({ orderBy: { name: 'asc' } });
    return { clients };
  });

  const updateClientSchema = z.object({
    name: clientDisplayNameSchema.optional(),
    defaultMode: z.enum(['PHOTO', 'TAG']).optional().nullable()
  });

  app.put('/clients/:id', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateClientSchema.parse(request.body);

    try {
      const client = await prisma.clientDevice.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          defaultMode: body.defaultMode ?? undefined
        }
      });

      return { client };
    } catch (error) {
      // PrismaのP2025エラー（レコードが見つからない）を404に変換
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'クライアントデバイスが見つかりません');
      }
      throw error;
    }
  });

  app.post('/clients/status', async (request) => {
    const clientKey = normalizeClientKey(request.headers['x-client-key']);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const metrics = metricSchema.parse(request.body);
    const now = new Date();

    const clientDevice = await prisma.clientDevice.upsert({
      where: { apiKey: clientKey },
      update: {
        statusClientId: metrics.clientId, // x-client-key と status-agent の clientId を紐づけ
        lastSeenAt: now
      },
      create: {
        name: metrics.hostname,
        apiKey: clientKey,
        statusClientId: metrics.clientId, // x-client-key と status-agent の clientId を紐づけ
        lastSeenAt: now
      }
    });

    const status = await prisma.clientStatus.upsert({
      where: { clientId: metrics.clientId },
      create: {
        clientId: metrics.clientId,
        hostname: metrics.hostname,
        ipAddress: metrics.ipAddress,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        diskUsage: metrics.diskUsage,
        temperature: metrics.temperature,
        uptimeSeconds: metrics.uptimeSeconds,
        lastBoot: metrics.lastBoot,
        lastSeen: now
      },
      update: {
        hostname: metrics.hostname,
        ipAddress: metrics.ipAddress,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        diskUsage: metrics.diskUsage,
        temperature: metrics.temperature,
        uptimeSeconds: metrics.uptimeSeconds,
        lastBoot: metrics.lastBoot,
        lastSeen: now
      }
    });

  const logEntries = metrics.logs ?? [];
    if (logEntries.length > 0) {
      await prisma.clientLog.createMany({
        data: logEntries.map((entry) => ({
          clientId: metrics.clientId,
          level: entry.level,
          message: entry.message.slice(0, 1000),
          context: entry.context ? (entry.context as Prisma.InputJsonValue) : undefined
        }))
      });
    }

    return {
      requestId: request.id,
      statusId: status.id,
      clientDeviceId: clientDevice.id,
      logsStored: logEntries.length
    };
  });

  app.post('/clients/logs', async (request) => {
    const clientKey = normalizeClientKey(request.headers['x-client-key']);
    if (!clientKey) {
      throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
    }

    const payload = logsPayloadSchema.parse(request.body);

    await prisma.clientDevice.upsert({
      where: { apiKey: clientKey },
      update: { lastSeenAt: new Date() },
      create: {
        apiKey: clientKey,
        name: payload.clientId,
        lastSeenAt: new Date()
      }
    });

    await prisma.clientLog.createMany({
      data: payload.logs.map((entry) => ({
        clientId: payload.clientId,
        level: entry.level,
        message: entry.message.slice(0, 1000),
        context: entry.context ? (entry.context as Prisma.InputJsonValue) : undefined
      }))
    });

    return { requestId: request.id, logsStored: payload.logs.length };
  });

  app.get('/clients/status', { preHandler: canViewStatus }, async (request) => {
    const statuses = await prisma.clientStatus.findMany({
      orderBy: { hostname: 'asc' }
    });

    const clientIds = statuses.map((status) => status.clientId);

    let groupedLogs = new Map<string, { level: string; message: string; createdAt: Date }[]>();
    if (clientIds.length > 0) {
      const logs = await prisma.clientLog.findMany({
        where: { clientId: { in: clientIds } },
        orderBy: { createdAt: 'desc' },
        take: clientIds.length * 5
      });
      groupedLogs = logs.reduce((map, log) => {
        const existing = map.get(log.clientId) ?? [];
        if (existing.length < 5) {
          existing.push({
            level: log.level,
            message: log.message,
            createdAt: log.createdAt
          });
          map.set(log.clientId, existing);
        }
        return map;
      }, new Map<string, { level: string; message: string; createdAt: Date }[]>());
    }

    return {
      requestId: request.id,
      clients: statuses.map((status) => {
        const lastSeen = status.lastSeen ?? status.updatedAt;
        const stale = Date.now() - lastSeen.getTime() > staleThresholdMs;
        return {
          clientId: status.clientId,
          hostname: status.hostname,
          ipAddress: status.ipAddress,
          cpuUsage: status.cpuUsage,
          memoryUsage: status.memoryUsage,
          diskUsage: status.diskUsage,
          temperature: status.temperature,
          uptimeSeconds: status.uptimeSeconds,
          lastBoot: status.lastBoot,
          lastSeen,
          stale,
          latestLogs: groupedLogs.get(status.clientId) ?? []
        };
      })
    };
  });

  app.get('/clients/logs', { preHandler: canViewStatus }, async (request) => {
    const query = logListQuerySchema.parse(request.query);

    const logs = await prisma.clientLog.findMany({
      where: {
        clientId: query.clientId ?? undefined,
        level: query.level ?? undefined,
        createdAt: query.since ? { gte: query.since } : undefined
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit
    });

    return { requestId: request.id, logs };
  });

  // アラート情報を取得（ダッシュボード用）
  // Phase2完全移行: DBのみを参照。fileAlertsは互換性のため空配列/0を返す（deprecated）

  app.get('/clients/alerts', { preHandler: canViewStatus }, async (request) => {
    const statuses = await prisma.clientStatus.findMany({
      orderBy: { hostname: 'asc' }
    });

    const now = Date.now();
    const staleClients = statuses.filter((status) => {
      const lastSeen = status.lastSeen ?? status.updatedAt;
      return now - lastSeen.getTime() > staleThresholdMs;
    });

    const clientIds = statuses.map((status) => status.clientId);
    const recentErrorLogs = clientIds.length > 0
      ? await prisma.clientLog.findMany({
          where: {
            clientId: { in: clientIds },
            level: 'ERROR',
            createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } // 過去24時間
          },
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      : [];

    // DBベースのアラートを読み込む（Phase2完全移行: DBのみ参照）
    const dbAlerts = await prisma.alert.findMany({
      where: {
        acknowledged: false
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 10, // 最新10件
      select: {
        id: true,
        type: true,
        message: true,
        timestamp: true,
        acknowledged: true,
        severity: true
      }
    });

    return {
      requestId: request.id,
      alerts: {
        staleClients: staleClients.length,
        errorLogs: recentErrorLogs.length,
        fileAlerts: 0, // deprecated: 互換性のため常に0
        dbAlerts: dbAlerts.length,
        hasAlerts: staleClients.length > 0 || recentErrorLogs.length > 0 || dbAlerts.length > 0
      },
      details: {
        staleClientIds: staleClients.map((s) => s.clientId),
        recentErrors: recentErrorLogs.map((log) => ({
          clientId: log.clientId,
          message: log.message,
          createdAt: log.createdAt
        })),
        fileAlerts: [], // deprecated: 互換性のため常に空配列
        dbAlerts: dbAlerts.map((alert) => ({
          id: alert.id,
          type: alert.type ?? undefined,
          message: alert.message ?? undefined,
          timestamp: alert.timestamp.toISOString(),
          acknowledged: alert.acknowledged,
          severity: alert.severity ?? undefined
        }))
      }
    };
  });

  // アラートを確認済みにする（Phase2完全移行: DBのみ更新）
  app.post('/clients/alerts/:id/acknowledge', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };

    // DB側のアラートを確認済みにする（Phase2完全移行: DBのみ更新）
    const dbAlert = await prisma.alert.findUnique({
      where: { id }
    });

    if (!dbAlert) {
      throw new ApiError(404, 'アラートが見つかりません');
    }

    if (dbAlert.acknowledged) {
      // 既に確認済みの場合は成功として返す（冪等性）
      return {
        requestId: request.id,
        acknowledged: true,
        acknowledgedInDb: true
      };
    }

    await prisma.alert.update({
      where: { id },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date()
      }
    });

    return {
      requestId: request.id,
      acknowledged: true,
      acknowledgedInDb: true
    };
  });
}
