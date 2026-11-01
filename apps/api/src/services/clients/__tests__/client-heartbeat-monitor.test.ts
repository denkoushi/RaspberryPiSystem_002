import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertDeliveryStatus, AlertSeverity } from '@prisma/client';

import { deployWindowEndedAt, refreshKioskDeployWindows } from '../kiosk-deploy-window.js';
import { ClientHeartbeatMonitor, runHeartbeatCheck } from '../client-heartbeat-monitor.js';
import {
  isMonitoredClient,
  isStale,
  loadHeartbeatAlertConfig,
  staleAlertFingerprint
} from '../client-heartbeat-alert-policy.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../kiosk-deploy-window.js', () => ({
  deployWindowEndedAt: vi.fn(async () => null),
  refreshKioskDeployWindows: vi.fn()
}));

vi.mock('../../../lib/prisma.js', () => {
  const tx = {
    alert: { create: vi.fn(async () => ({ id: 'created-alert' })) },
    alertDelivery: { create: vi.fn() }
  };
  return {
    prisma: {
      clientStatus: { findMany: vi.fn() },
      alert: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx
    }
  };
});

vi.mock('../../alerts/alerts-config.js', () => ({
  loadAlertsDispatcherConfig: vi.fn(async () => ({ routing: { byTypePrefix: {}, defaultRoute: 'ops' } })),
  resolveRouteKey: vi.fn(() => 'ops')
}));

const tx = (prisma as unknown as { __tx: { alert: { create: ReturnType<typeof vi.fn> }; alertDelivery: { create: ReturnType<typeof vi.fn> } } }).__tx;
const NOW = new Date('2026-09-30T03:00:00.000Z');
const config = loadHeartbeatAlertConfig({});
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function createdAlerts() {
  return tx.alert.create.mock.calls.map(([arg]) => (arg as { data: Record<string, unknown> }).data);
}

describe('client-heartbeat-alert-policy', () => {
  it('uses 10 minutes, the factory Pi pattern, and can be disabled', () => {
    expect(config.enabled).toBe(true);
    expect(config.staleAfterMs).toBe(10 * 60_000);
    expect(loadHeartbeatAlertConfig({ CLIENT_HEARTBEAT_ALERT_ENABLED: 'false' }).enabled).toBe(false);
    expect(loadHeartbeatAlertConfig({ CLIENT_HEARTBEAT_STALE_MINUTES: '30' }).staleAfterMs).toBe(30 * 60_000);
    expect(loadHeartbeatAlertConfig({ CLIENT_HEARTBEAT_STALE_MINUTES: 'abc' }).staleAfterMs).toBe(10 * 60_000);
  });

  it('monitors factory Pis only', () => {
    expect(isMonitoredClient('raspi4-kensaku-02-kiosk1', config)).toBe(true);
    expect(isMonitoredClient('raspberrypi4-kiosk1', config)).toBe(true);
    expect(isMonitoredClient('raspberrypi3-signage1', config)).toBe(true);
    expect(isMonitoredClient('zero-edge-1', config)).toBe(true);
    expect(isMonitoredClient('zero-edge-123', config)).toBe(true);
    expect(isMonitoredClient('zero-edge', config)).toBe(false);
    expect(isMonitoredClient('other-zero-edge-1', config)).toBe(false);
    expect(isMonitoredClient('mac-kiosk-1', config)).toBe(false);
    expect(isMonitoredClient('zero2w-tanaban01-edge1', config)).toBe(false);
  });

  it('falls back to the factory pattern but preserves an explicit override', () => {
    expect(isMonitoredClient('zero-edge-1', loadHeartbeatAlertConfig({
      CLIENT_HEARTBEAT_CLIENT_ID_PATTERN: '['
    }))).toBe(true);
    expect(isMonitoredClient('zero-edge-1', loadHeartbeatAlertConfig({
      CLIENT_HEARTBEAT_CLIENT_ID_PATTERN: '^raspi'
    }))).toBe(false);
  });

  it('treats 10 minutes to 7 days of silence as stale', () => {
    const at = (minutes: number) => ({ clientId: 'raspi4-a', lastSeen: minutesAgo(minutes) });
    expect(isStale(at(9), NOW, config)).toBe(false);
    expect(isStale(at(11), NOW, config)).toBe(true);
    expect(isStale(at(8 * 24 * 60), NOW, config)).toBe(false);
  });
});

describe('runHeartbeatCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([]);
  });

  it('skips a stale client during deploy and alerts on the same outage after grace', async () => {
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-silent-kiosk1', lastSeen: minutesAgo(15) }
    ] as never);
    const end = new Date(NOW.getTime() + 5 * 60_000);
    vi.mocked(deployWindowEndedAt).mockResolvedValueOnce(end);
    await runHeartbeatCheck(NOW, config);
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(createdAlerts()).toHaveLength(0);
    vi.mocked(deployWindowEndedAt).mockResolvedValueOnce(end);
    await runHeartbeatCheck(end, config);
    expect(createdAlerts()).toHaveLength(1);
    expect(createdAlerts()[0].type).toBe('client-heartbeat-stale');
  });

  it('queues one Slack warning for a silent Pi and ignores fresh and unmonitored clients', async () => {
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-silent-kiosk1', lastSeen: minutesAgo(15) },
      { clientId: 'raspi4-fresh-kiosk1', lastSeen: minutesAgo(1) },
      { clientId: 'mac-kiosk-1', lastSeen: minutesAgo(60) }
    ] as never);

    await runHeartbeatCheck(NOW, config);

    const alerts = createdAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'client-heartbeat-stale',
      severity: AlertSeverity.WARNING,
      fingerprint: staleAlertFingerprint('raspi4-silent-kiosk1', minutesAgo(15)),
      details: { clientId: 'raspi4-silent-kiosk1' }
    });
    expect(alerts[0].message).toContain('15分経過');
    expect(tx.alertDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ alertId: 'created-alert', routeKey: 'ops', status: AlertDeliveryStatus.PENDING })
    });
  });

  it('does not repeat the warning for the same outage', async () => {
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-silent-kiosk1', lastSeen: minutesAgo(30) }
    ] as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'existing' } as never);

    await runHeartbeatCheck(NOW, config);

    expect(createdAlerts()).toHaveLength(0);
  });

  it('closes a notified outage and announces the recovery', async () => {
    const silentSince = minutesAgo(40);
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-back-kiosk1', lastSeen: minutesAgo(0) }
    ] as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([
      {
        id: 'stale-1',
        fingerprint: 'fp-1',
        details: { clientId: 'raspi4-back-kiosk1', lastSeen: silentSince.toISOString() },
        deliveries: [{ status: AlertDeliveryStatus.SENT }]
      }
    ] as never);

    await runHeartbeatCheck(NOW, config);

    expect(prisma.alert.update).toHaveBeenCalledWith({
      where: { id: 'stale-1' },
      data: { acknowledged: true, acknowledgedAt: NOW }
    });
    const alerts = createdAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'client-heartbeat-recovered', severity: AlertSeverity.INFO });
    expect(alerts[0].message).toContain('約40分間途絶');
  });

  it('closes a short outage silently when the warning was never sent', async () => {
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-blip-kiosk1', lastSeen: minutesAgo(0) }
    ] as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([
      {
        id: 'stale-2',
        fingerprint: 'fp-2',
        details: { clientId: 'raspi4-blip-kiosk1', lastSeen: minutesAgo(12).toISOString() },
        deliveries: [{ status: AlertDeliveryStatus.PENDING }]
      }
    ] as never);

    await runHeartbeatCheck(NOW, config);

    expect(prisma.alert.update).toHaveBeenCalledTimes(1);
    expect(createdAlerts()).toHaveLength(0);
  });

  it('keeps the outage open while the client is still silent', async () => {
    const silentSince = minutesAgo(40);
    vi.mocked(prisma.clientStatus.findMany).mockResolvedValue([
      { clientId: 'raspi4-down-kiosk1', lastSeen: silentSince }
    ] as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'stale-3' } as never);
    vi.mocked(prisma.alert.findMany).mockResolvedValue([
      {
        id: 'stale-3',
        fingerprint: 'fp-3',
        details: { clientId: 'raspi4-down-kiosk1', lastSeen: silentSince.toISOString() },
        deliveries: [{ status: AlertDeliveryStatus.SENT }]
      }
    ] as never);

    await runHeartbeatCheck(NOW, config);

    expect(prisma.alert.update).not.toHaveBeenCalled();
    expect(createdAlerts()).toHaveLength(0);
  });
});


describe('heartbeat tick deploy sampling', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('refreshes deploy windows during startup grace before checking heartbeats', async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    const monitor = new ClientHeartbeatMonitor();
    try {
      await monitor.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(refreshKioskDeployWindows).toHaveBeenCalledWith(expect.any(Date));
      expect(prisma.clientStatus.findMany).not.toHaveBeenCalled();
    } finally {
      await monitor.stop();
    }
  });
});
