import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

const staleThresholdMs = 1000 * 60 * 60 * 12; // 12 hours

export async function getClientAlertsDashboard(requestId: string) {
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
          createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
    : [];

  const dbAlerts = await prisma.alert.findMany({
    where: {
      acknowledged: false
    },
    orderBy: {
      timestamp: 'desc'
    },
    take: 10,
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
    requestId,
    alerts: {
      staleClients: staleClients.length,
      errorLogs: recentErrorLogs.length,
      fileAlerts: 0,
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
      fileAlerts: [],
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
}

export async function acknowledgeClientAlert(requestId: string, id: string) {
  const dbAlert = await prisma.alert.findUnique({
    where: { id }
  });

  if (!dbAlert) {
    throw new ApiError(404, 'アラートが見つかりません');
  }

  if (dbAlert.acknowledged) {
    return {
      requestId,
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
    requestId,
    acknowledged: true,
    acknowledgedInDb: true
  };
}
