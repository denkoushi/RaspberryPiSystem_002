import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { acknowledgeClientAlert, getClientAlertsDashboard } from '../client-alerts.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientStatus: {
      findMany: vi.fn(),
    },
    clientLog: {
      findMany: vi.fn(),
    },
    alert: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('client-alerts.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stale client / error log / db alert を集約する', async () => {
    const now = Date.now();
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      {
        clientId: 'client-stale',
        hostname: 'stale-host',
        lastSeen: new Date(now - 13 * 60 * 60 * 1000),
        updatedAt: new Date(now - 13 * 60 * 60 * 1000),
      },
      {
        clientId: 'client-fresh',
        hostname: 'fresh-host',
        lastSeen: new Date(now - 10 * 60 * 1000),
        updatedAt: new Date(now - 10 * 60 * 1000),
      },
    ] as never);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([
      { clientId: 'client-stale', message: 'boom', createdAt: new Date(now - 1000) },
    ] as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([
      {
        id: 'alert-1',
        type: 'stale-client',
        message: 'stale',
        timestamp: new Date(now - 1000),
        acknowledged: false,
        severity: 'WARN',
      },
    ] as never);

    const result = await getClientAlertsDashboard('req-1');

    expect(result.alerts.staleClients).toBe(1);
    expect(result.alerts.errorLogs).toBe(1);
    expect(result.alerts.dbAlerts).toBe(1);
    expect(result.alerts.hasAlerts).toBe(true);
    expect(result.details.staleClientIds).toEqual(['client-stale']);
    expect(result.details.recentErrors).toHaveLength(1);
    expect(result.details.dbAlerts).toHaveLength(1);
  });

  it('未存在アラートのacknowledgeは404を返す', async () => {
    vi.mocked(prisma.alert.findUnique).mockResolvedValue(null);

    await expect(acknowledgeClientAlert('req-2', 'missing-id')).rejects.toThrow(ApiError);
    await expect(acknowledgeClientAlert('req-2', 'missing-id')).rejects.toThrow(
      'アラートが見つかりません'
    );
    expect(prisma.alert.update).not.toHaveBeenCalled();
  });

  it('未acknowledgeアラートをacknowledgeする', async () => {
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: 'alert-2',
      acknowledged: false,
    } as never);
    vi.mocked(prisma.alert.update).mockResolvedValue({ id: 'alert-2', acknowledged: true } as never);

    const result = await acknowledgeClientAlert('req-3', 'alert-2');

    expect(result).toEqual({
      requestId: 'req-3',
      acknowledged: true,
      acknowledgedInDb: true,
    });
    expect(prisma.alert.update).toHaveBeenCalledTimes(1);
  });
});

