import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  clientDevice: { update: vi.fn(), findFirst: vi.fn() },
  clientStatus: { upsert: vi.fn() },
  clientLog: { createMany: vi.fn() },
  alert: { findFirst: vi.fn(), create: vi.fn() },
  alertDelivery: { create: vi.fn() },
  kioskInquiryThread: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }));
vi.mock('../../alerts/alerts-config.js', () => ({
  loadAlertsDispatcherConfig: vi.fn().mockResolvedValue({ routing: {} }),
  resolveRouteKey: vi.fn().mockReturnValue('ops')
}));

import { upsertClientStatus } from '../client-telemetry.service.js';

const startedAt = new Date('2026-10-22T13:10:00Z');
const hour = 60 * 60 * 1000;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(startedAt);
  vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', '');
  db.clientDevice.update.mockResolvedValue({ id: 'device-1' });
  db.clientStatus.upsert.mockResolvedValue({ id: 'status-1' });
  db.clientDevice.findFirst.mockResolvedValue({ location: '第2工場 - Sessaku-01' });
  db.alert.findFirst.mockResolvedValue({ id: 'existing-alert' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('deduped telemetry notices', () => {
  it.each([
    ['storage_health', 'ext4_errors_recorded', 'ERROR', hour],
    ['storage_health', 'kernel_storage_error', 'ERROR', hour],
    ['storage_health', 'root_filesystem_read_only', 'ERROR', hour],
    ['storage_health', 'ext4_errors_recorded', 'WARN', 24 * hour],
    ['storage_health', 'storage_write_rate_high', 'ERROR', 24 * hour],
    ['terminal_agent_health', 'heartbeat', 'ERROR', 24 * hour]
  ] as const)('repeats %s %s %s only after %i ms without extra alerts or Slack deliveries', async (category, signal, level, interval) => {
    const context = {
      category, signal, agent: 'barcode', action: 'unhealthy',
      episodeId: '3d594650-3436-4a9f-bf51-2524200ea34e', observedAt: startedAt.toISOString(), consecutiveFailures: 3
    };
    const key = JSON.stringify([category, 'raspi4-sessaku-01-kiosk1', ...(category === 'terminal_agent_health' ? ['barcode'] : []), signal]);
    const title = `第2工場 - Sessaku-01 ${category === 'terminal_agent_health' ? 'バーコードリーダー' : 'SDカード'}`;
    const thread = { id: 'thread-1', noticeTitle: title, messages: [{ createdAt: startedAt }] };
    db.kioskInquiryThread.findFirst.mockResolvedValue(thread);
    async function reportAt(elapsed: number) {
      vi.setSystemTime(new Date(startedAt.getTime() + elapsed));
      await upsertClientStatus({ clientKey: 'key', requestId: 'req', metrics: {
        clientId: 'raspi4-sessaku-01-kiosk1', hostname: 'pi4', ipAddress: '192.0.2.1', cpuUsage: 0, memoryUsage: 0, diskUsage: 0,
        logs: [{ level, message: 'health error', context }]
      } });
    }

    for (const elapsed of [0, hour - 1, interval - 1]) await reportAt(elapsed);
    expect(db.kioskInquiryThread.update).not.toHaveBeenCalled();
    await reportAt(interval);
    expect(db.kioskInquiryThread.update).toHaveBeenCalledExactlyOnceWith({ where: { id: thread.id }, data: {
      receiverUnread: true, lastMessageAt: new Date(startedAt.getTime() + interval),
      messages: { create: { side: 'SYSTEM', body: expect.any(String), createdAt: new Date(startedAt.getTime() + interval) } }
    } });
    expect(db.kioskInquiryThread.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: 'SYSTEM_NOTICE', noticeKey: key, noticeResolvedAt: null }
    }));
    // The next window starts at the repeated system message, not the original alert.
    thread.messages[0].createdAt = new Date(startedAt.getTime() + interval);
    await reportAt(2 * interval - 1);
    expect(db.kioskInquiryThread.update).toHaveBeenCalledOnce();
    await reportAt(2 * interval);
    expect(db.kioskInquiryThread.update).toHaveBeenCalledTimes(2);
    expect(db.alert.findFirst).toHaveBeenCalledWith({
      where: { ...(category === 'storage_health' ? { acknowledged: false } : {}), fingerprint: expect.any(String) },
      select: { id: true }
    });
    expect(db.alert.create).not.toHaveBeenCalled();
    expect(db.alertDelivery.create).not.toHaveBeenCalled();
    expect(db.kioskInquiryThread.create).not.toHaveBeenCalled();
  });
});
