import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
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

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');
  const canViewStatus = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.post('/clients/heartbeat', async (request) => {
    const body = heartbeatSchema.parse(request.body);

    const client = await prisma.clientDevice.upsert({
      where: { apiKey: body.apiKey },
      update: {
        name: body.name,
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
    defaultMode: z.enum(['PHOTO', 'TAG']).optional().nullable()
  });

  app.put('/clients/:id', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateClientSchema.parse(request.body);

    try {
      const client = await prisma.clientDevice.update({
        where: { id },
        data: {
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
        name: metrics.hostname,
        lastSeenAt: now
      },
      create: {
        name: metrics.hostname,
        apiKey: clientKey,
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
          context: entry.context ?? undefined
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
        context: entry.context ?? undefined
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
}
