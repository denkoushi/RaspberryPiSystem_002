import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  kioskInquiryThread: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  alert: { findFirst: vi.fn() },
  clientLog: { findFirst: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }));
import { deliverSystemNotice, resolveInactiveFileNotices, resolveQuietKioskUiErrorNotices, SYSTEM_NOTICE_REPEAT_MS, FILE_NOTICE_EXPIRY_MS, KIOSK_NOTICE_QUIET_MS } from '../system-notice.service.js';

const now = new Date('2026-10-13T00:00:00Z');
const notice = { key: 'test', title: '端末 通信', body: '端末からの連絡が途絶えています。', state: 'open' as const };
beforeEach(() => { vi.resetAllMocks(); db.kioskInquiryThread.findFirst.mockResolvedValue(null); });

describe('system notice delivery', () => {
  it('creates an unread system thread without a sender under a database lock', async () => {
    await deliverSystemNotice(notice, now);
    expect(db.$queryRaw).toHaveBeenCalledOnce();
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.kioskInquiryThread.findFirst.mock.invocationCallOrder[0]);
    const data = db.kioskInquiryThread.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: 'SYSTEM_NOTICE', noticeKey: 'test', receiverUnread: true,
      messages: { create: { side: 'SYSTEM', body: notice.body, createdAt: now } } });
    expect(data.senderClientDeviceId).toBeUndefined();
  });
  it.each([SYSTEM_NOTICE_REPEAT_MS - 1, SYSTEM_NOTICE_REPEAT_MS])('24h boundary: %i ms', async (age) => {
    db.kioskInquiryThread.findFirst.mockResolvedValue({ id: 'thread', noticeTitle: notice.title, messages: [{ createdAt: new Date(now.getTime() - age) }] });
    await deliverSystemNotice(notice, now);
    expect(db.kioskInquiryThread.create).not.toHaveBeenCalled();
    expect(db.kioskInquiryThread.update).toHaveBeenCalledTimes(age < SYSTEM_NOTICE_REPEAT_MS ? 0 : 1);
    expect(db.kioskInquiryThread.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: { messages: { where: { side: 'SYSTEM' }, orderBy: { createdAt: 'desc' }, take: 1 } }
    }));
  });
  it('refreshes a changed title inside the repeat window without marking unread', async () => {
    db.kioskInquiryThread.findFirst.mockResolvedValue({ id: 'thread', noticeTitle: 'Mac 空き容量', messages: [{ createdAt: now }] });
    await deliverSystemNotice(notice, now);
    expect(db.kioskInquiryThread.update).toHaveBeenCalledWith({ where: { id: 'thread' }, data: { noticeTitle: notice.title } });
  });
  it('recovers immediately, appends a short message and marks unread', async () => {
    db.kioskInquiryThread.findFirst.mockResolvedValue({ id: 'thread', messages: [{ createdAt: now }] });
    await deliverSystemNotice({ ...notice, state: 'recovered' }, now);
    expect(db.kioskInquiryThread.update).toHaveBeenCalledWith({ where: { id: 'thread' }, data: {
      receiverUnread: true, lastMessageAt: now, noticeResolvedAt: now,
      messages: { create: { side: 'SYSTEM', body: '復旧しました。', createdAt: now } }
    } });
  });
  it('does nothing for recovery without an unresolved thread', async () => {
    await deliverSystemNotice({ ...notice, state: 'recovered' }, now);
    expect(db.kioskInquiryThread.create).not.toHaveBeenCalled();
    expect(db.kioskInquiryThread.update).not.toHaveBeenCalled();
  });
  it('reuses the unresolved thread on repeated calls', async () => {
    db.kioskInquiryThread.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'thread', messages: [{ createdAt: now }] });
    await deliverSystemNotice(notice, now);
    await deliverSystemNotice(notice, now);
    expect(db.kioskInquiryThread.create).toHaveBeenCalledOnce();
  });
  it.each([false, true])('silently expires files only when no occurrence in 48h (recent=%s)', async (recent) => {
    db.kioskInquiryThread.findMany.mockResolvedValue([{ id: 'thread', noticeKey: 'file:rkhunter-warning' }]);
    db.alert.findFirst.mockResolvedValue(recent ? { id: 'alert' } : null);
    await resolveInactiveFileNotices(now);
    expect(db.alert.findFirst).toHaveBeenCalledWith({ where: { type: 'rkhunter-warning',
      timestamp: { gt: new Date(now.getTime() - FILE_NOTICE_EXPIRY_MS) } }, select: { id: true } });
    expect(db.kioskInquiryThread.updateMany).toHaveBeenCalledTimes(recent ? 0 : 1);
    if (!recent) expect(db.kioskInquiryThread.updateMany.mock.calls[0][0].data).toEqual({ noticeResolvedAt: now });
  });
});

describe('quiet kiosk UI error notices', () => {
  it.each([
    ['device', false], ['device', true], ['client', false], ['client', true]
  ] as const)('matches %s and silently resolves only when quiet (recent=%s)', async (deviceId, recent) => {
    const key = JSON.stringify(['kiosk_ui_error', 'client', deviceId]);
    db.kioskInquiryThread.findMany.mockResolvedValue([{ id: 'thread', noticeKey: key }]);
    db.clientLog.findFirst.mockResolvedValue(recent ? { id: 'log' } : null);
    await resolveQuietKioskUiErrorNotices(now);
    expect(KIOSK_NOTICE_QUIET_MS).toBe(30 * 60 * 1000);
    expect(db.kioskInquiryThread.findMany).toHaveBeenCalledWith({
      where: { kind: 'SYSTEM_NOTICE', noticeResolvedAt: null }, select: { id: true, noticeKey: true }
    });
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.anything(), key);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.clientLog.findFirst.mock.invocationCallOrder[0]);
    expect(db.clientLog.findFirst).toHaveBeenCalledWith({
      where: {
        ...(deviceId === 'client' ? { clientId: 'client' } : {}),
        level: 'ERROR', createdAt: { gte: new Date(now.getTime() - KIOSK_NOTICE_QUIET_MS) },
        AND: [
          { context: { path: ['category'], equals: 'kiosk_ui_error' } },
          ...(deviceId === 'client' ? [] : [{ context: { path: ['clientDeviceId'], equals: 'device' } }])
        ]
      }, select: { id: true }
    });
    expect(db.kioskInquiryThread.updateMany).toHaveBeenCalledTimes(recent ? 0 : 1);
    if (!recent) expect(db.kioskInquiryThread.updateMany).toHaveBeenCalledWith({
      where: { id: 'thread', noticeResolvedAt: null }, data: { noticeResolvedAt: now }
    });
    expect(db.kioskInquiryThread.update).not.toHaveBeenCalled();
    expect(db.kioskInquiryThread.create).not.toHaveBeenCalled();
  });
  it.each([
    null, 'file:rkhunter-warning', 'status:client:stale', '[broken', 'null', '{}',
    '["storage_health","client","device"]', '["kiosk_ui_error","client"]',
    '["kiosk_ui_error","client","device","extra"]', '["kiosk_ui_error",1,"device"]',
    '["kiosk_ui_error","client",null]', '["kiosk_ui_error","","device"]', '["kiosk_ui_error","client",""]'
  ])('ignores unrelated or malformed key %s', async (noticeKey) => {
    db.kioskInquiryThread.findMany.mockResolvedValue([{ id: 'thread', noticeKey }]);
    await resolveQuietKioskUiErrorNotices(now);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.clientLog.findFirst).not.toHaveBeenCalled();
    expect(db.kioskInquiryThread.updateMany).not.toHaveBeenCalled();
  });
  it('creates a new thread on an error after quiet resolution', async () => {
    const key = JSON.stringify(['kiosk_ui_error', 'client', 'device']);
    db.kioskInquiryThread.findMany.mockResolvedValue([{ id: 'thread', noticeKey: key }]);
    db.clientLog.findFirst.mockResolvedValue(null);
    await resolveQuietKioskUiErrorNotices(now);
    await deliverSystemNotice({ ...notice, key }, now);
    expect(db.kioskInquiryThread.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: 'SYSTEM_NOTICE', noticeKey: key, noticeResolvedAt: null }
    }));
    expect(db.kioskInquiryThread.create).toHaveBeenCalledOnce();
  });
});
