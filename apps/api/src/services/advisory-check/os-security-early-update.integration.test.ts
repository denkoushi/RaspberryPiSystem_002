import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { deliverSystemNotice } from '../kiosk-inquiry/system-notice.service.js';
import { createOsSecurityUpdateRequest, sweepOsSecurityUpdateRequests } from './os-security-early-update.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));

describe('OS security update persistence', () => {
  const log = { warn: vi.fn() };
  const noticeKeys: string[] = [];
  const clientIds: string[] = [];

  afterEach(async () => {
    const keys = noticeKeys.splice(0);
    await prisma.kioskInquiryThread.deleteMany({ where: { noticeKey: { in: keys } } });
    await prisma.osSecurityUpdateRequest.deleteMany({ where: { noticeKey: { in: keys } } });
    const ids = clientIds.splice(0);
    await prisma.osSecurityUpdateClientReport.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.clientDevice.deleteMany({ where: { statusClientId: { in: ids } } });
    vi.unstubAllEnvs();
    log.warn.mockClear();
  });

  function newNoticeKey() {
    const key = `jpcert:test-${randomUUID()}`;
    noticeKeys.push(key);
    return key;
  }

  it('persists one request and its targets on concurrent creation', async () => {
    const now = new Date();
    const clientId = `raspi-test-${randomUUID()}`;
    clientIds.push(clientId);
    vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', `^${clientId}$`);
    await prisma.clientDevice.create({ data: { apiKey: randomUUID(), statusClientId: clientId, name: '試験端末' } });
    await prisma.osSecurityUpdateClientReport.create({
      data: { clientId, earlyEnabled: true, report: { earlyEnabled: true, requests: [], check: null }, receivedAt: now },
    });
    const noticeKey = newNoticeKey();
    const input = { noticeKey, title: '更新試験', url: 'https://www.jpcert.or.jp/a',
      products: { Chromium: { packages: ['chromium'], comparable: true, fixedVersion: '131.0' } } };

    expect(await Promise.all([createOsSecurityUpdateRequest(input, now), createOsSecurityUpdateRequest(input, now)]))
      .toEqual(['auto', 'auto']);
    const requests = await prisma.osSecurityUpdateRequest.findMany({ where: { advisoryKey: noticeKey }, include: { targets: true } });
    expect(requests).toHaveLength(1);
    expect(requests[0].targets).toEqual([expect.objectContaining({ clientId, state: 'pending', deliveredAt: null })]);
  });

  it('targets only fresh reports and uses trial when an expected client report is stale', async () => {
    const now = new Date();
    const prefix = `raspi-test-${randomUUID()}`;
    const freshClientId = `${prefix}-fresh`;
    const staleClientId = `${prefix}-stale`;
    const enrolledIds = [freshClientId, staleClientId];
    clientIds.push(...enrolledIds);
    vi.stubEnv('CLIENT_HEARTBEAT_CLIENT_ID_PATTERN', `^${prefix}-`);
    vi.stubEnv('CLIENT_HEARTBEAT_STALE_MINUTES', '2');
    await prisma.clientDevice.createMany({
      data: enrolledIds.map(statusClientId => ({ apiKey: randomUUID(), statusClientId, name: '試験端末' })),
    });
    const staleAfterMs = 2 * 60_000;
    await prisma.osSecurityUpdateClientReport.createMany({
      data: enrolledIds.map((clientId, index) => ({
        clientId,
        earlyEnabled: true,
        report: { earlyEnabled: true, requests: [], check: null },
        receivedAt: new Date(now.getTime() - staleAfterMs - index),
      })),
    });
    const noticeKey = newNoticeKey();
    const input = { noticeKey, title: '更新試験', url: 'https://www.jpcert.or.jp/a',
      products: { Chromium: { packages: ['chromium'], comparable: true, fixedVersion: '131.0' } } };

    expect(await createOsSecurityUpdateRequest(input, now)).toBe('trial');
    const request = await prisma.osSecurityUpdateRequest.findUniqueOrThrow({
      where: { advisoryKey: noticeKey }, include: { targets: true },
    });
    expect(request.targets.map(target => target.clientId)).toEqual([freshClientId]);

    const staleOnlyNoticeKey = newNoticeKey();
    const later = new Date(now.getTime() + 1);
    expect(await createOsSecurityUpdateRequest({ ...input, noticeKey: staleOnlyNoticeKey }, later)).toBeUndefined();
    expect(await prisma.osSecurityUpdateRequest.findUnique({ where: { advisoryKey: staleOnlyNoticeKey } })).toBeNull();
  });

  it('rolls back an interrupted notice and sends only once across two concurrent sweeps', async () => {
    const now = new Date();
    const noticeKey = newNoticeKey();
    const request = await prisma.osSecurityUpdateRequest.create({ data: {
      advisoryKey: noticeKey, noticeKey, title: '更新試験', url: 'https://www.jpcert.or.jp/a',
      products: {}, packages: ['chromium'], mode: 'auto', expiresAt: new Date(now.getTime() - 1),
      targets: { create: { clientId: 'raspi-expired-test', detail: { reason: 'awaiting_check' } } },
    } });

    await sweepOsSecurityUpdateRequests(now, async (notice, at, tx) => {
      if (notice.key !== noticeKey) return;
      await deliverSystemNotice(notice, at, tx);
      throw new Error('interrupted after notice write');
    }, log);
    expect(await prisma.osSecurityUpdateRequest.findUnique({ where: { id: request.id } })).toHaveProperty('status', 'open');
    expect(await prisma.kioskInquiryThread.count({ where: { noticeKey } })).toBe(0);

    const deliver = vi.fn<typeof deliverSystemNotice>(async (notice, at, tx) => {
      if (notice.key === noticeKey) await deliverSystemNotice(notice, at, tx);
    });
    await Promise.all([sweepOsSecurityUpdateRequests(now, deliver, log), sweepOsSecurityUpdateRequests(now, deliver, log)]);
    expect(deliver.mock.calls.filter(([notice]) => notice.key === noticeKey)).toHaveLength(1);
    expect(await prisma.osSecurityUpdateRequest.findUnique({ where: { id: request.id } })).toHaveProperty('status', 'notified');
    const threads = await prisma.kioskInquiryThread.findMany({ where: { noticeKey }, include: { messages: true } });
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toEqual([expect.objectContaining({ body: expect.stringContaining('raspi-expired-test') })]);
  });
});
