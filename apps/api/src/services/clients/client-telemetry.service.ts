import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

const staleThresholdMs = 1000 * 60 * 60 * 12; // 12 hours
const storageHealthCategory = 'storage_health';
const storageHealthAlertTypePrefix = 'storage-health';

type ClientTelemetryLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type ClientTelemetryLogEntry = {
  level: ClientTelemetryLogLevel;
  message: string;
  context?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStorageHealthAlertLog(entry: ClientTelemetryLogEntry): boolean {
  return (
    (entry.level === 'WARN' || entry.level === 'ERROR') &&
    isRecord(entry.context) &&
    entry.context.category === storageHealthCategory
  );
}

function storageHealthSignal(context: Record<string, unknown>): string {
  const raw = context.signal;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown_signal';
}

function storageHealthTimestamp(context: Record<string, unknown>): Date {
  const observedAt = context.observedAt;
  if (typeof observedAt === 'string') {
    const parsed = new Date(observedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

async function createStorageHealthSlackAlerts(params: {
  clientId: string;
  logs: ClientTelemetryLogEntry[];
  requestId: string;
}): Promise<void> {
  const alertLogs = params.logs.filter(isStorageHealthAlertLog);
  if (alertLogs.length === 0) return;

  try {
    const config = await loadAlertsDispatcherConfig();

    for (const entry of alertLogs) {
      const context = entry.context ?? {};
      const signal = storageHealthSignal(context);
      const type = `${storageHealthAlertTypePrefix}-${signal}`;
      const severity = entry.level === 'ERROR' ? AlertSeverity.ERROR : AlertSeverity.WARNING;
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${type}:${params.clientId}:${signal}`)
        .digest('hex');

      const existingOpenAlert = await prisma.alert.findFirst({
        where: {
          fingerprint,
          acknowledged: false
        },
        select: { id: true }
      });
      if (existingOpenAlert) continue;

      const routeKey = resolveRouteKey(type, config.routing);
      await prisma.$transaction(async (tx) => {
        const alert = await tx.alert.create({
          data: {
            id: crypto.randomUUID(),
            type,
            severity,
            message: `SDカードヘルス異常: ${params.clientId}: ${entry.message.slice(0, 500)}`,
            details: {
              clientId: params.clientId,
              level: entry.level,
              signal,
              logMessage: entry.message,
              logContext: context
            } as Prisma.InputJsonValue,
            source: {
              service: 'status-agent',
              clientId: params.clientId,
              category: storageHealthCategory
            } as Prisma.InputJsonValue,
            context: {
              requestId: params.requestId
            } as Prisma.InputJsonValue,
            fingerprint,
            timestamp: storageHealthTimestamp(context),
            acknowledged: false
          }
        });

        await tx.alertDelivery.create({
          data: {
            alertId: alert.id,
            channel: AlertChannel.SLACK,
            routeKey,
            status: AlertDeliveryStatus.PENDING,
            attemptCount: 0
          }
        });
      });
    }
  } catch (error) {
    logger.warn({ err: error, clientId: params.clientId }, '[ClientTelemetry] failed to create storage health alert');
  }
}

/**
 * 管理者のみ: 端末を inventory 等から登録・再同期する（create + update の upsert）。
 * update では表示名を上書きしない（管理画面の手動編集と競合させない）。
 */
export async function registerClientDeviceAdmin(params: {
  apiKey: string;
  name: string;
  location?: string | null;
}) {
  const now = new Date();
  return prisma.clientDevice.upsert({
    where: { apiKey: params.apiKey },
    update: {
      location: params.location ?? undefined,
      lastSeenAt: now,
    },
    create: {
      name: params.name,
      location: params.location ?? undefined,
      apiKey: params.apiKey,
      lastSeenAt: now,
    },
  });
}

/**
 * 登録済み端末のみ: x-client-key 相当のキーで生存通知（lastSeen / location）。
 * 未登録キーは 404。
 */
export async function touchClientHeartbeat(params: { clientKey: string; location?: string | null }) {
  const now = new Date();
  try {
    return await prisma.clientDevice.update({
      where: { apiKey: params.clientKey },
      data: {
        location: params.location ?? undefined,
        lastSeenAt: now,
      },
    });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError(404, 'クライアントデバイスが見つかりません', undefined, 'CLIENT_DEVICE_NOT_FOUND');
    }
    throw error;
  }
}

async function requireRegisteredClientDevice(clientKey: string, data: {
  lastSeenAt: Date;
  statusClientId?: string;
}) {
  try {
    return await prisma.clientDevice.update({
      where: { apiKey: clientKey },
      data,
    });
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError(404, 'クライアントデバイスが見つかりません', undefined, 'CLIENT_DEVICE_NOT_FOUND');
    }
    throw error;
  }
}

export async function listClientDevices() {
  return prisma.clientDevice.findMany({ orderBy: { name: 'asc' } });
}

export async function updateClientDevice(params: {
  id: string;
  name?: string;
  defaultMode?: 'PHOTO' | 'TAG' | null;
  kioskInitialRoute?: string | null;
  haizenEdgeEnabled?: boolean;
  shelfLayoutEditEnabled?: boolean;
}) {
  try {
    return await prisma.clientDevice.update({
      where: { id: params.id },
      data: {
        name: params.name ?? undefined,
        defaultMode: params.defaultMode ?? undefined,
        ...(params.kioskInitialRoute !== undefined ? { kioskInitialRoute: params.kioskInitialRoute } : {}),
        ...(params.haizenEdgeEnabled !== undefined ? { haizenEdgeEnabled: params.haizenEdgeEnabled } : {}),
        ...(params.shelfLayoutEditEnabled !== undefined
          ? { shelfLayoutEditEnabled: params.shelfLayoutEditEnabled }
          : {})
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
    logs?: ClientTelemetryLogEntry[];
  };
  requestId: string;
}) {
  const { clientKey, metrics, requestId } = params;
  const now = new Date();

  const clientDevice = await requireRegisteredClientDevice(clientKey, {
    statusClientId: metrics.clientId,
    lastSeenAt: now,
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
    await createStorageHealthSlackAlerts({
      clientId: metrics.clientId,
      logs: logEntries,
      requestId
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
  logs: ClientTelemetryLogEntry[];
  requestId: string;
}) {
  const { clientKey, clientId, logs, requestId } = params;
  await requireRegisteredClientDevice(clientKey, { lastSeenAt: new Date() });

  await prisma.clientLog.createMany({
    data: logs.map((entry) => ({
      clientId,
      level: entry.level,
      message: entry.message.slice(0, 1000),
      context: entry.context ? (entry.context as Prisma.InputJsonValue) : undefined
    }))
  });
  await createStorageHealthSlackAlerts({ clientId, logs, requestId });

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
