import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

const staleThresholdMs = 1000 * 60 * 60 * 12; // 12 hours

export async function upsertClientHeartbeat(params: {
  apiKey: string;
  name: string;
  location?: string | null;
}) {
  const now = new Date();
  return prisma.clientDevice.upsert({
    where: { apiKey: params.apiKey },
    update: {
      location: params.location ?? undefined,
      lastSeenAt: now
    },
    create: {
      name: params.name,
      location: params.location ?? undefined,
      apiKey: params.apiKey,
      lastSeenAt: now
    }
  });
}

export async function listClientDevices() {
  return prisma.clientDevice.findMany({ orderBy: { name: 'asc' } });
}

export async function updateClientDevice(params: {
  id: string;
  name?: string;
  defaultMode?: 'PHOTO' | 'TAG' | null;
}) {
  try {
    return await prisma.clientDevice.update({
      where: { id: params.id },
      data: {
        name: params.name ?? undefined,
        defaultMode: params.defaultMode ?? undefined
      }
    });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError(404, 'クライアントデバイスが見つかりません');
    }
    throw error;
  }
}

export async function upsertClientStatus(params: {
  clientKey: string;
  metrics: {
    clientId: string;
    hostname: string;
    ipAddress: string;
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    temperature?: number;
    uptimeSeconds?: number;
    lastBoot?: Date;
    logs?: Array<{ level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; message: string; context?: Record<string, unknown> }>;
  };
  requestId: string;
}) {
  const { clientKey, metrics, requestId } = params;
  const now = new Date();

  const clientDevice = await prisma.clientDevice.upsert({
    where: { apiKey: clientKey },
    update: {
      statusClientId: metrics.clientId,
      lastSeenAt: now
    },
    create: {
      name: metrics.hostname,
      apiKey: clientKey,
      statusClientId: metrics.clientId,
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
    requestId,
    statusId: status.id,
    clientDeviceId: clientDevice.id,
    logsStored: logEntries.length
  };
}

export async function storeClientLogs(params: {
  clientKey: string;
  clientId: string;
  logs: Array<{ level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; message: string; context?: Record<string, unknown> }>;
  requestId: string;
}) {
  const { clientKey, clientId, logs, requestId } = params;
  await prisma.clientDevice.upsert({
    where: { apiKey: clientKey },
    update: { lastSeenAt: new Date() },
    create: {
      apiKey: clientKey,
      name: clientId,
      lastSeenAt: new Date()
    }
  });

  await prisma.clientLog.createMany({
    data: logs.map((entry) => ({
      clientId,
      level: entry.level,
      message: entry.message.slice(0, 1000),
      context: entry.context ? (entry.context as Prisma.InputJsonValue) : undefined
    }))
  });

  return { requestId, logsStored: logs.length };
}

export async function getClientStatusesWithLatestLogs(requestId: string) {
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
    requestId,
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
}

export async function listClientLogs(params: {
  requestId: string;
  clientId?: string;
  level?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  limit: number;
  since?: Date;
}) {
  const logs = await prisma.clientLog.findMany({
    where: {
      clientId: params.clientId ?? undefined,
      level: params.level ?? undefined,
      createdAt: params.since ? { gte: params.since } : undefined
    },
    orderBy: { createdAt: 'desc' },
    take: params.limit
  });
  return { requestId: params.requestId, logs };
}
