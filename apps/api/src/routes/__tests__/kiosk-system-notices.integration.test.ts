import { randomUUID } from 'node:crypto';
import type { ClientDevice, Employee, KioskInquiryReceiverEmployee } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { deliverSystemNotice, resolveInactiveFileNotices, FILE_NOTICE_EXPIRY_MS } from '../../services/kiosk-inquiry/system-notice.service.js';
import { sendSlackNotification } from '../../services/notifications/slack-webhook.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

vi.mock('../../services/notifications/slack-webhook.js', () => ({ sendSlackNotification: vi.fn().mockResolvedValue(undefined) }));

describe('system notice inbox API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let device: ClientDevice;
  let sender: ClientDevice;
  let employee: Employee;
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let originalDevices: { id: string; inquiryReceiverEnabled: boolean; systemNoticeReceiverEnabled: boolean }[];
  let originalEmployees: KioskInquiryReceiverEmployee[];
  let key: string;
  const threadIds: string[] = [];
  beforeAll(async () => { app = await buildServer(); admin = await createTestUser('ADMIN'); });
  beforeEach(async () => {
    originalDevices = await prisma.clientDevice.findMany({ select: { id: true, inquiryReceiverEnabled: true, systemNoticeReceiverEnabled: true } });
    originalEmployees = await prisma.kioskInquiryReceiverEmployee.findMany();
    device = await createTestClientDevice(); sender = await createTestClientDevice(); employee = await createTestEmployee();
    await prisma.kioskInquiryReceiverEmployee.create({ data: { employeeId: employee.id } });
    key = `test:${randomUUID()}`; threadIds.length = 0;
    vi.mocked(sendSlackNotification).mockClear();
  });
  afterEach(async () => {
    await prisma.kioskInquiryThread.deleteMany({ where: { OR: [{ id: { in: threadIds } }, { noticeKey: key }, { senderClientDeviceId: { in: [device.id, sender.id] } }] } });
    await prisma.alert.deleteMany({ where: { type: key.slice('file:'.length) } });
    await prisma.kioskInquiryReceiverEmployee.deleteMany();
    if (originalEmployees.length) await prisma.kioskInquiryReceiverEmployee.createMany({ data: originalEmployees });
    for (const { id, ...data } of originalDevices) await prisma.clientDevice.update({ where: { id }, data });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.clientDevice.deleteMany({ where: { id: { in: [device.id, sender.id] } } });
  });
  afterAll(async () => { await app?.close(); if (admin) await prisma.user.delete({ where: { id: admin.user.id } }); });
  const tag = () => ({ employeeTagUid: employee.nfcTagUid! });
  const call = (path: string, payload?: Record<string, unknown>) => app.inject({
    method: path === 'summary' ? 'GET' : 'POST', url: `/api/kiosk/inquiries/${path}`,
    headers: { 'x-client-key': device.apiKey }, ...(path === 'summary' ? {} : { payload: payload ?? {} })
  });
  const notice = () => ({ key, title: 'StoneBase01 バーコードリーダー', body: 'バーコードリーダーが応答しません。', state: 'open' as const });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'filters summary/list/open/reply: inquiry=%s system=%s', async (inquiryReceiverEnabled, systemNoticeReceiverEnabled) => {
      device = await prisma.clientDevice.update({ where: { id: device.id }, data: { inquiryReceiverEnabled, systemNoticeReceiverEnabled } });
      const receiver = inquiryReceiverEnabled || systemNoticeReceiverEnabled;
      const baseline = (await call('summary')).json().unreadCount;
      const inquiry = await prisma.kioskInquiryThread.create({ data: { senderClientDeviceId: sender.id, page: '/kiosk', lastMessageAt: new Date() } });
      await deliverSystemNotice(notice());
      const system = await prisma.kioskInquiryThread.findFirstOrThrow({ where: { noticeKey: key } });
      expect(system.senderClientDeviceId).toBeNull();
      expect((await call('summary')).json()).toEqual({ isReceiver: receiver, loginUnlock: false,
        unreadCount: baseline + Number(inquiryReceiverEnabled) + Number(systemNoticeReceiverEnabled) });
      if (receiver) {
        for (const path of ['list', `${system.id}/open`, `${system.id}/reply`]) {
          expect((await call(path, { ...(path.endsWith('reply') ? { body: '交換しました' } : {}) })).statusCode).toBe(401);
        }
        expect((await call('list', { employeeTagUid: 'not-allowed' })).statusCode).toBe(403);
      }
      const listed = await call('list', receiver ? tag() : {});
      expect(listed.statusCode).toBe(200);
      const ids = listed.json().threads.map((thread: { id: string }) => thread.id);
      expect(ids.includes(inquiry.id)).toBe(inquiryReceiverEnabled);
      expect(ids.includes(system.id)).toBe(systemNoticeReceiverEnabled);
      for (const [id, allowed] of [[inquiry.id, inquiryReceiverEnabled], [system.id, systemNoticeReceiverEnabled]] as const) {
        expect((await call(`${id}/open`, tag())).statusCode).toBe(allowed ? 200 : 404);
        expect((await call(`${id}/reply`, { ...tag(), body: '交換しました' })).statusCode).toBe(allowed ? 200 : 404);
      }
      expect(sendSlackNotification).not.toHaveBeenCalled();
      expect((await prisma.kioskInquiryThread.findUniqueOrThrow({ where: { id: system.id } })).senderUnread).toBe(false);
    });

  it('system-only receiver retains sender behavior for its own inquiries', async () => {
    device = await prisma.clientDevice.update({ where: { id: device.id }, data: { systemNoticeReceiverEnabled: true } });
    const own = await prisma.kioskInquiryThread.create({ data: { senderClientDeviceId: device.id, page: '/kiosk', lastMessageAt: new Date(), senderUnread: true } });
    expect((await call('summary')).json().unreadCount).toBeGreaterThanOrEqual(1);
    const opened = await call(`${own.id}/open`, tag());
    expect(opened.json().thread).toMatchObject({ isReceiver: false, unread: false });
    const reply = await call(`${own.id}/reply`, { ...tag(), body: 'お願いします' });
    expect(reply.json().messages[0].side).toBe('SENDER');
    expect(sendSlackNotification).toHaveBeenCalledOnce();
  });

  it('full-replace settings save controls both flags and rejects unknown system receivers atomically', async () => {
    const put = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/kiosk-settings/inquiry-receivers', headers: createAuthHeader(admin.token), payload });
    const payload = { receiverClientDeviceIds: [sender.id], systemNoticeReceiverClientDeviceIds: [device.id, device.id], employeeCodes: [employee.employeeCode] };
    const result = await put(payload);
    expect(result.statusCode).toBe(200);
    expect(result.json().settings.devices.find((item: { id: string }) => item.id === device.id)).toMatchObject({ inquiryReceiverEnabled: false, systemNoticeReceiverEnabled: true });
    expect(result.json().settings.devices.find((item: { id: string }) => item.id === sender.id)).toMatchObject({ inquiryReceiverEnabled: true, systemNoticeReceiverEnabled: false });
    expect((await put({ ...payload, systemNoticeReceiverClientDeviceIds: [randomUUID()] })).statusCode).toBe(400);
    expect((await prisma.clientDevice.findUniqueOrThrow({ where: { id: device.id } })).systemNoticeReceiverEnabled).toBe(true);
    expect((await put({ receiverClientDeviceIds: [], systemNoticeReceiverClientDeviceIds: [], employeeCodes: [] })).statusCode).toBe(200);
    expect(await prisma.clientDevice.count({ where: { OR: [{ inquiryReceiverEnabled: true }, { systemNoticeReceiverEnabled: true }] } })).toBe(0);
  });

  it('concurrent calls create one unresolved thread, recovery and recurrence create separate episodes', async () => {
    await Promise.all(Array.from({ length: 8 }, () => deliverSystemNotice(notice())));
    const threads = await prisma.kioskInquiryThread.findMany({ where: { noticeKey: key }, include: { messages: true } });
    expect(threads).toHaveLength(1); expect(threads[0].messages).toHaveLength(1);
    await expect(prisma.kioskInquiryThread.create({ data: { kind: 'SYSTEM_NOTICE', noticeKey: key, page: '/kiosk', lastMessageAt: new Date() } })).rejects.toMatchObject({ code: 'P2002' });
    await deliverSystemNotice({ ...notice(), state: 'recovered' });
    await deliverSystemNotice(notice());
    expect(await prisma.kioskInquiryThread.count({ where: { noticeKey: key } })).toBe(2);
    expect(await prisma.kioskInquiryThread.count({ where: { noticeKey: key, noticeResolvedAt: null } })).toBe(1);
  });

  it('silently closes file notices after 48 hours and allows a later recurrence', async () => {
    key = `file:test-${randomUUID()}`;
    const now = new Date(); const old = new Date(now.getTime() - FILE_NOTICE_EXPIRY_MS);
    await prisma.alert.create({ data: { id: randomUUID(), type: key.slice(5), timestamp: old } });
    await deliverSystemNotice(notice(), old);
    const thread = await prisma.kioskInquiryThread.findFirstOrThrow({ where: { noticeKey: key } });
    await prisma.kioskInquiryThread.update({ where: { id: thread.id }, data: { receiverUnread: false } });
    await resolveInactiveFileNotices(now, key.slice(5));
    expect(await prisma.kioskInquiryThread.findUniqueOrThrow({ where: { id: thread.id }, include: { messages: true } })).toMatchObject({
      noticeResolvedAt: now, receiverUnread: false, lastMessageAt: old, messages: [expect.objectContaining({ side: 'SYSTEM' })]
    });
    await deliverSystemNotice(notice(), now);
    expect(await prisma.kioskInquiryThread.count({ where: { noticeKey: key } })).toBe(2);
  });
});
