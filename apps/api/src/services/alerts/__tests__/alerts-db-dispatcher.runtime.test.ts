import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockAlertUpdate = vi.hoisted(() => vi.fn());
const mockLoadAlertsDispatcherConfig = vi.hoisted(() => vi.fn());
const mockSendSlackWebhook = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    alertDelivery: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
      update: mockUpdate,
    },
    alert: {
      update: mockAlertUpdate,
    },
  },
}));

vi.mock('../alerts-config.js', () => ({
  loadAlertsDispatcherConfig: mockLoadAlertsDispatcherConfig,
}));

vi.mock('../slack-sink.js', () => ({
  sendSlackWebhook: mockSendSlackWebhook,
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { AlertsDbDispatcher } from '../alerts-db-dispatcher.js';

function buildConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    mode: 'db',
    enabled: true,
    intervalSeconds: 30,
    maxAttempts: 5,
    retryDelaySeconds: 60,
    webhookTimeoutMs: 1000,
    alertsDir: '/tmp/alerts',
    dbDispatcher: {
      enabled: true,
      intervalSeconds: 1,
      batchSize: 10,
      claimLeaseSeconds: 30,
    },
    dedupe: {
      enabled: false,
      defaultWindowSeconds: 600,
      windowSecondsByRouteKey: {},
    },
    slack: {
      enabled: true,
      webhooks: {
        ops: 'https://hooks.slack.com/services/test',
      },
    },
    routing: {
      byTypePrefix: {},
      defaultRoute: 'ops',
    },
    ...overrides,
  };
}

function buildEligibleDelivery(overrides?: Partial<Record<string, unknown>>) {
  const now = new Date();
  return {
    id: 'delivery-1',
    alertId: 'alert-1',
    routeKey: 'ops',
    attemptCount: 0,
    alert: {
      id: 'alert-1',
      type: 'storage-usage-high',
      message: 'high usage',
      severity: 'warning',
      details: { usage: 95 },
      source: null,
      context: null,
      fingerprint: null,
      timestamp: now,
      acknowledged: false,
    },
    ...overrides,
  };
}

describe('AlertsDbDispatcher runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockUpdate.mockResolvedValue({});
    mockAlertUpdate.mockResolvedValue({});
    mockSendSlackWebhook.mockResolvedValue({ ok: true });
    mockLoadAlertsDispatcherConfig.mockResolvedValue(buildConfig());
  });

  it('runOnceNow returns early when db dispatcher is disabled', async () => {
    mockLoadAlertsDispatcherConfig.mockResolvedValue(buildConfig({ dbDispatcher: { enabled: false } }));
    const dispatcher = new AlertsDbDispatcher();

    await dispatcher.runOnceNow();

    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('suppresses acknowledged alert deliveries', async () => {
    mockFindMany.mockResolvedValue([buildEligibleDelivery({ alert: { ...buildEligibleDelivery().alert, acknowledged: true } })]);
    const dispatcher = new AlertsDbDispatcher();

    await dispatcher.runOnceNow();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUPPRESSED',
          lastError: 'Acknowledged',
        }),
      })
    );
    expect(mockSendSlackWebhook).not.toHaveBeenCalled();
  });

  it('marks delivery as SENT when webhook succeeds', async () => {
    mockFindMany.mockResolvedValue([buildEligibleDelivery()]);
    mockSendSlackWebhook.mockResolvedValue({ ok: true });
    const dispatcher = new AlertsDbDispatcher();

    await dispatcher.runOnceNow();

    expect(mockSendSlackWebhook).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          attemptCount: 1,
          lastError: null,
        }),
      })
    );
  });

  it('schedules next retry when webhook fails below max attempts', async () => {
    mockFindMany.mockResolvedValue([buildEligibleDelivery()]);
    mockSendSlackWebhook.mockResolvedValue({ ok: false, error: 'temporary error' });
    const dispatcher = new AlertsDbDispatcher();

    await dispatcher.runOnceNow();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          attemptCount: 1,
          lastError: 'temporary error',
          nextAttemptAt: expect.any(Date),
        }),
      })
    );
  });

  it('start triggers periodic runs and stop halts them', async () => {
    vi.useFakeTimers();
    try {
      mockFindMany.mockResolvedValue([]);
      mockLoadAlertsDispatcherConfig.mockResolvedValue(buildConfig());
      const dispatcher = new AlertsDbDispatcher();

      await dispatcher.start();
      expect(mockFindMany).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFindMany).toHaveBeenCalledTimes(2);

      await dispatcher.stop();
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockFindMany).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
