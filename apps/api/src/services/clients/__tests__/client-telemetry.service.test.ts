import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listClientDevices,
  listClientLogs,
  registerClientDeviceAdmin,
  storeClientLogs,
  touchClientHeartbeat,
  upsertClientStatus,
} from '../client-telemetry.service.js';
import { prisma } from '../../../lib/prisma.js';
import { deliverTelemetryNotice } from '../../kiosk-inquiry/system-notice-sources.js';
import { KIOSK_ALERT_COOLDOWN_MS, KIOSK_NETWORK_ALERT_COOLDOWN_MS } from '../client-telemetry-alert-policy.js';
import { deployWindowEndedAt } from '../kiosk-deploy-window.js';
import { resolveRouteKey } from '../../alerts/alerts-config.js';

vi.mock('../kiosk-deploy-window.js', () => ({ deployWindowEndedAt: vi.fn(async () => null) }));

vi.mock('../../kiosk-inquiry/system-notice-sources.js', () => ({ deliverTelemetryNotice: vi.fn() }));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    clientDevice: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    clientStatus: { upsert: vi.fn() },
    clientLog: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    alert: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../alerts/alerts-config.js', () => ({
  loadAlertsDispatcherConfig: vi.fn().mockResolvedValue({ routing: { byTypePrefix: { 'terminal-agent-health-': 'ops' }, defaultRoute: 'support' } }),
  resolveRouteKey: vi.fn().mockReturnValue('ops')
}));

describe('client-telemetry.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registerClientDeviceAdmin は clientDevice を upsert する', async () => {
    vi.mocked(prisma.clientDevice.upsert).mockResolvedValue({
      id: 'device-1',
      name: 'kiosk-1',
    } as never);

    await registerClientDeviceAdmin({
      apiKey: 'api-key-1',
      name: 'kiosk-1',
      location: null,
    });

    expect(prisma.clientDevice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.clientDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { apiKey: 'api-key-1' },
        create: expect.objectContaining({ name: 'kiosk-1', apiKey: 'api-key-1' }),
      })
    );
  });

  it('touchClientHeartbeat は既存キーの lastSeen / location を更新する', async () => {
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({
      id: 'device-1',
      name: 'kiosk-1',
      location: 'B',
    } as never);

    const row = await touchClientHeartbeat({ clientKey: 'ck-1', location: 'B' });

    expect(row.location).toBe('B');
    expect(prisma.clientDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { apiKey: 'ck-1' },
        data: expect.objectContaining({ location: 'B' }),
      })
    );
  });

  it('clientDevice一覧をname昇順で取得する', async () => {
    vi.mocked(prisma.clientDevice.findMany).mockResolvedValue([
      { id: 'device-a', name: 'A' },
      { id: 'device-b', name: 'B' },
    ] as never);

    const result = await listClientDevices();

    expect(result).toHaveLength(2);
    expect(prisma.clientDevice.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('storeClientLogsはmessageを1000文字に切り詰めて保存する', async () => {
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientLog.createMany).mockResolvedValue({ count: 1 } as never);
    const longMessage = 'x'.repeat(1500);

    const result = await storeClientLogs({
      clientKey: 'client-key-1',
      clientId: 'client-1',
      requestId: 'req-logs',
      logs: [{ level: 'ERROR', message: longMessage }],
    });

    expect(result).toEqual({ requestId: 'req-logs', logsStored: 1 });
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          clientId: 'client-1',
          level: 'ERROR',
          message: 'x'.repeat(1000),
        }),
      ],
    });
  });
});


describe('OS update health delivery', () => {
  const context = {
    category: 'os_update_health', action: 'unhealthy', signal: 'os_security_update_failed', mode: 'apply',
    episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e', observedAt: '2026-10-25T00:00:00Z', lastSuccessAt: null
  };
  const alertCreate = vi.fn();
  const deliveryCreate = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(prisma.clientStatus.upsert).mockResolvedValue({ id: 'status-1' } as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
    alertCreate.mockResolvedValue({ id: 'alert-1' });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      return (callback as (tx: unknown) => Promise<unknown>)({ alert: { create: alertCreate }, alertDelivery: { create: deliveryCreate } });
    });
  });
  async function report(level: 'WARN' | 'INFO', extra: Record<string, unknown> = {}) {
    return upsertClientStatus({ clientKey: 'key', requestId: 'req', metrics: {
      clientId: 'raspi5-server', hostname: 'pi5', ipAddress: '192.0.2.1', cpuUsage: 0, memoryUsage: 0, diskUsage: 0,
      logs: [{ level, message: 'do-not-store', context: { ...context, installed: ['do-not-store'], ...extra } }]
    } });
  }
  it('stores a sanitized alert and delivers Chat without queuing Slack', async () => {
    await report('WARN');
    expect(alertCreate).toHaveBeenCalledOnce();
    expect(alertCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'os-update-health-os_security_update_failed' }) });
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(deliverTelemetryNotice).toHaveBeenCalledWith('raspi5-server', expect.objectContaining({ level: 'WARN' }));
    expect(JSON.stringify(vi.mocked(prisma.clientLog.createMany).mock.calls)).not.toContain('do-not-store');
    expect(JSON.stringify(alertCreate.mock.calls)).not.toContain('do-not-store');
  });
  it('routes sanitized INFO recovery to Chat without creating an alert', async () => {
    await report('INFO', { action: 'recovery' });
    expect(deliverTelemetryNotice).toHaveBeenCalledWith('raspi5-server', expect.objectContaining({
      level: 'INFO', context: expect.objectContaining({ action: 'recovery', category: 'os_update_health' })
    }));
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });
  it('retries Chat for an already stored alert without duplicating it', async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'existing' } as never);
    await report('WARN');
    expect(deliverTelemetryNotice).toHaveBeenCalledOnce();
    expect(alertCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });
  it('does not route malformed recovery', async () => {
    const result = await report('INFO', { action: 'recovery', signal: 'unknown' });
    expect(result.logsStored).toBe(0);
    expect(deliverTelemetryNotice).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });
});

describe('kiosk UI logs', () => {
  it.each(['api_network', 'render_crash'])('suppresses %s without creating an Alert row during deploy', async (kind) => {
    vi.mocked(deployWindowEndedAt).mockResolvedValueOnce(new Date(Date.now() + 60_000));
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [
      { level: 'ERROR', message: 'failed', context: { category: 'kiosk_ui_error', kind, count: 99 } }
    ] });
    expect(deployWindowEndedAt).toHaveBeenCalledWith('pi4-real', expect.any(Date));
    expect(prisma.clientLog.createMany).toHaveBeenCalled();
    expect(prisma.clientLog.findMany).not.toHaveBeenCalled();
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('counts only errors after the deploy grace ends and resumes alerting', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-10-30T00:00:00Z');
    vi.setSystemTime(now);
    vi.spyOn(process, 'uptime').mockReturnValue(3600);
    const end = new Date(now.getTime() - 60_000);
    vi.mocked(deployWindowEndedAt).mockResolvedValueOnce(end);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([{ context: { kind: 'api_network', count: 3 } }] as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'existing' } as never);
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [
      { level: 'ERROR', message: 'failed', context: { category: 'kiosk_ui_error', kind: 'api_network' } }
    ] });
    expect(prisma.clientLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: end } })
    }));
    expect(prisma.alert.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: 'kiosk-network-degraded' })
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1', name: '組立端末', statusClientId: 'pi4-real' } as never);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue(null);
  });
  it('overrides clientId and adds device context only for kiosk_ui_error', async () => {
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [
      { level: 'WARN', message: 'kiosk', context: { category: 'kiosk_ui_error', kind: 'api_4xx' } },
      { level: 'ERROR', message: 'legacy', context: { category: 'legacy' } }
    ] });
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ clientId: 'pi4-real', context: { category: 'kiosk_ui_error', kind: 'api_4xx', clientDeviceId: 'device-1', clientDeviceName: '組立端末' } }),
      expect.objectContaining({ clientId: 'placeholder', context: { category: 'legacy' } })
    ] });
  });
  it('preserves payload clientId when statusClientId is missing', async () => {
    vi.mocked(prisma.clientDevice.update).mockResolvedValue({ id: 'device-1', name: '端末', statusClientId: null } as never);
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'WARN', message: 'kiosk', context: { category: 'kiosk_ui_error' } }] });
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ clientId: 'placeholder' })] });
  });
  it('filters category with JSON path and preserves default querying', async () => {
    const { logListQuerySchema } = await import('../../../routes/clients/shared.js');
    expect(logListQuerySchema.parse({ category: 'kiosk_ui_error' }).category).toBe('kiosk_ui_error');
    await listClientLogs({ requestId: 'req', limit: 50, category: 'kiosk_ui_error' });
    expect(prisma.clientLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ context: { path: ['category'], equals: 'kiosk_ui_error' } }) }));
    await listClientLogs({ requestId: 'req', limit: 50 });
    expect(prisma.clientLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ context: undefined }) }));
  });
  it.each([
    ['api_5xx', 'kiosk-ui-error', KIOSK_ALERT_COOLDOWN_MS],
    ['api_timeout', 'kiosk-network-degraded', KIOSK_NETWORK_ALERT_COOLDOWN_MS],
    ['api_network', 'kiosk-network-degraded', KIOSK_NETWORK_ALERT_COOLDOWN_MS]
  ] as const)('sums %s counts and respects the per-device acknowledged cooldown', async (kind, type, cooldown) => {
    vi.useFakeTimers();
    const now = new Date('2026-10-08T12:01:00Z'); vi.setSystemTime(now);
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(3600);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([{ context: { kind, count: 2 } }, { context: { kind, count: 1 } }] as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind, count: 1 } }] });
    expect(prisma.clientLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ level: 'ERROR', createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) }, AND: [
      { context: { path: ['category'], equals: 'kiosk_ui_error' } }, { context: { path: ['clientDeviceId'], equals: 'device-1' } }
    ] }) }));
    expect(prisma.alert.findFirst).toHaveBeenCalledWith({ where: { type, timestamp: { gt: new Date(now.getTime() - cooldown) }, source: { path: ['clientDeviceId'], equals: 'device-1' } }, select: { id: true } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    uptime.mockRestore();
  });
  it.each(['api_5xx', 'api_timeout', 'api_network'])('does not inflate %s counts with the other error class', async (kind) => {
    vi.spyOn(process, 'uptime').mockReturnValue(3600);
    const otherKind = kind === 'api_5xx' ? 'api_network' : 'api_5xx';
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([{ context: { kind, count: 2 } }, { context: { kind: otherKind, count: 50 } }] as never);
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind } }] });
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('delivers screen and network alerts with separate counts through the existing route and channel', async () => {
    vi.spyOn(process, 'uptime').mockReturnValue(3600);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([
      { context: { kind: 'api_timeout', count: 2 } }, { context: { kind: 'api_network', count: 1 } },
      { context: { kind: 'api_5xx', count: 2 } }, { context: { kind: 'window_error', count: 2 } }
    ] as never);
    const createAlert = vi.fn().mockResolvedValue({ id: 'alert-1' });
    const createDelivery = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      if (typeof callback !== 'function') throw new Error('Expected transaction callback');
      return callback({ alert: { create: createAlert }, alertDelivery: { create: createDelivery } } as never);
    });
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: ['api_timeout', 'api_5xx'].map((kind) => ({
      level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind, count: 1, urlPath: '/kiosk/config' }
    })) });
    expect(createAlert.mock.calls.map(([{ data }]) => ({ type: data.type, severity: data.severity, count: data.details.count }))).toEqual([
      { type: 'kiosk-network-degraded', severity: 'WARNING', count: 3 }, { type: 'kiosk-ui-error', severity: 'ERROR', count: 4 }
    ]);
    expect(resolveRouteKey).toHaveBeenCalledTimes(2);
    expect(resolveRouteKey).toHaveBeenCalledWith('terminal-agent-health-kiosk-ui', expect.any(Object));
    expect(createDelivery).toHaveBeenCalledTimes(2);
    expect(createDelivery).toHaveBeenCalledWith({ data: { alertId: 'alert-1', channel: 'SLACK', routeKey: 'ops', status: 'PENDING', attemptCount: 0 } });
  });
  it.each(['api_5xx', 'api_timeout', 'api_network'])('does not count or alert on %s errors stored right after API start', async (kind) => {
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(30);
    vi.mocked(prisma.clientLog.findMany).mockClear();
    vi.mocked(prisma.alert.findFirst).mockClear();
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind, count: 9 } }] });
    expect(prisma.clientLog.createMany).toHaveBeenCalled();
    expect(prisma.clientLog.findMany).not.toHaveBeenCalled();
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    uptime.mockRestore();
  });
  it('identifies kiosk_net_stats by the registered device and never alerts', async () => {
    await storeClientLogs({ clientKey: 'key', clientId: 'kiosk-web', requestId: 'req', logs: [
      { level: 'ERROR', message: 'stats', context: { category: 'kiosk_net_stats', requests: 100, failures: 90, clientDeviceId: 'spoof', clientDeviceName: 'spoof' } },
      { level: 'WARN', message: 'weak wifi', context: { category: 'network_health', signalDbm: -90 } }
    ] });
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ clientId: 'pi4-real', context: { category: 'kiosk_net_stats', requests: 100, failures: 90, clientDeviceId: 'device-1', clientDeviceName: '組立端末' } }),
      expect.objectContaining({ clientId: 'kiosk-web', context: { category: 'network_health', signalDbm: -90 } })
    ] });
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('stores network_health through the existing status metrics path without Slack', async () => {
    vi.mocked(prisma.clientStatus.upsert).mockResolvedValue({ id: 'status-1' } as never);
    const result = await upsertClientStatus({ clientKey: 'key', requestId: 'req', metrics: {
      clientId: 'pi4-actual', hostname: 'pi4', ipAddress: '192.0.2.1', cpuUsage: 0, memoryUsage: 0, diskUsage: 0,
      logs: [{ level: 'WARN', message: 'weak wifi', context: { category: 'network_health', signalDbm: -90, statusPostOk: false } }]
    } });
    expect(result.logsStored).toBe(1);
    expect(prisma.clientLog.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      clientId: 'pi4-actual', level: 'WARN', context: { category: 'network_health', signalDbm: -90, statusPostOk: false }
    })] });
    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

});
