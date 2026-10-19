import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listClientDevices,
  listClientLogs,
  registerClientDeviceAdmin,
  storeClientLogs,
  touchClientHeartbeat,
  upsertClientStatus,
} from '../client-telemetry.service.js';
import { prisma } from '../../../lib/prisma.js';

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


describe('kiosk UI logs', () => {
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
  it('sums counts in the DB window and respects acknowledged cooldown across buckets', async () => {
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(3600);
    vi.mocked(prisma.clientLog.findMany).mockResolvedValue([{ context: { count: 2 } }, { context: { count: 1 } }] as never);
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind: 'api_network', count: 1 } }] });
    expect(prisma.clientLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ level: 'ERROR', AND: [
      { context: { path: ['category'], equals: 'kiosk_ui_error' } }, { context: { path: ['clientDeviceId'], equals: 'device-1' } }
    ] }) }));
    expect(prisma.alert.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: 'kiosk-ui-error', timestamp: { gt: expect.any(Date) }, source: { path: ['clientDeviceId'], equals: 'device-1' } }) }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    uptime.mockRestore();
  });
  it('does not count or alert on errors stored right after API start', async () => {
    const uptime = vi.spyOn(process, 'uptime').mockReturnValue(30);
    vi.mocked(prisma.clientLog.findMany).mockClear();
    vi.mocked(prisma.alert.findFirst).mockClear();
    await storeClientLogs({ clientKey: 'key', clientId: 'placeholder', requestId: 'req', logs: [{ level: 'ERROR', message: 'kiosk', context: { category: 'kiosk_ui_error', kind: 'api_network', count: 9 } }] });
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
