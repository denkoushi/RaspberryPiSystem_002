import { randomUUID } from 'node:crypto';
import type { ClientDevice, Employee, KioskInquiryReceiverEmployee } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { sendSlackNotification } from '../../services/notifications/slack-webhook.js';
import { createAuthHeader, createTestClientDevice, createTestEmployee, createTestUser } from './helpers.js';

vi.mock('../../services/notifications/slack-webhook.js', () => ({
  sendSlackNotification: vi.fn().mockResolvedValue(undefined)
}));

describe('Kiosk inquiry inbox API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let sender: ClientDevice;
  let otherSender: ClientDevice;
  let receiver: ClientDevice;
  let allowedEmployee: Employee;
  let deniedEmployee: Employee;
  let inactiveEmployee: Employee;
  let suspendedEmployee: Employee;
  let originalDeviceIds: string[];
  let originalReceivers: KioskInquiryReceiverEmployee[];
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let manager: Awaited<ReturnType<typeof createTestUser>>;
  let viewer: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    app = await buildServer();
    admin = await createTestUser('ADMIN');
    manager = await createTestUser('MANAGER');
    viewer = await createTestUser('VIEWER');
  });

  beforeEach(async () => {
    originalDeviceIds = (await prisma.clientDevice.findMany({
      where: { inquiryReceiverEnabled: true }, select: { id: true }
    })).map(({ id }) => id);
    originalReceivers = await prisma.kioskInquiryReceiverEmployee.findMany();
    sender = await createTestClientDevice();
    otherSender = await createTestClientDevice();
    receiver = await createTestClientDevice();
    receiver = await prisma.clientDevice.update({
      where: { id: receiver.id }, data: { inquiryReceiverEnabled: true }
    });
    allowedEmployee = await createTestEmployee();
    deniedEmployee = await createTestEmployee();
    inactiveEmployee = await createTestEmployee();
    suspendedEmployee = await createTestEmployee();
    await prisma.employee.update({ where: { id: inactiveEmployee.id }, data: { status: 'INACTIVE' } });
    await prisma.employee.update({ where: { id: suspendedEmployee.id }, data: { status: 'SUSPENDED' } });
    await prisma.kioskInquiryReceiverEmployee.createMany({
      data: [allowedEmployee, inactiveEmployee, suspendedEmployee].map(({ id }) => ({ employeeId: id }))
    });
    vi.mocked(sendSlackNotification).mockClear();
  });

  afterEach(async () => {
    const deviceIds = [sender.id, otherSender.id, receiver.id];
    const employeeIds = [allowedEmployee.id, deniedEmployee.id, inactiveEmployee.id, suspendedEmployee.id];
    await prisma.kioskInquiryThread.deleteMany({ where: { senderClientDeviceId: { in: deviceIds } } });
    await prisma.clientLog.deleteMany({ where: { clientId: { in: deviceIds } } });
    await prisma.kioskInquiryReceiverEmployee.deleteMany();
    if (originalReceivers.length) {
      await prisma.kioskInquiryReceiverEmployee.createMany({ data: originalReceivers });
    }
    await prisma.clientDevice.updateMany({ data: { inquiryReceiverEnabled: false } });
    await prisma.clientDevice.updateMany({ where: { id: { in: originalDeviceIds } }, data: { inquiryReceiverEnabled: true } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.clientDevice.deleteMany({ where: { id: { in: deviceIds } } });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.user.deleteMany({ where: { id: { in: [admin.user.id, manager.user.id, viewer.user.id] } } });
  });

  const headers = (device: ClientDevice, token?: string) => ({ 'x-client-key': device.apiKey, ...(token ? createAuthHeader(token) : {}) });
  const tag = () => ({ employeeTagUid: allowedEmployee.nfcTagUid! });
  const summary = (device: ClientDevice, token?: string) => app.inject({
    method: 'GET', url: '/api/kiosk/inquiries/summary', headers: headers(device, token)
  });
  const list = (device: ClientDevice, payload: Record<string, unknown> = {}, token?: string) => app.inject({
    method: 'POST', url: '/api/kiosk/inquiries/list', headers: headers(device, token), payload
  });
  const open = (device: ClientDevice, id: string, payload: Record<string, unknown> = {}, token?: string) => app.inject({
    method: 'POST', url: `/api/kiosk/inquiries/${id}/open`, headers: headers(device, token), payload
  });
  const reply = (device: ClientDevice, id: string, payload: Record<string, unknown>, token?: string) => app.inject({
    method: 'POST', url: `/api/kiosk/inquiries/${id}/reply`, headers: headers(device, token), payload
  });
  const settingsUrl = '/api/kiosk-settings/inquiry-receivers';
  const putSettings = (payload: Record<string, unknown>) => app.inject({
    method: 'PUT', url: settingsUrl, headers: createAuthHeader(admin.token), payload
  });
  const getSettings = () => app.inject({ method: 'GET', url: settingsUrl, headers: createAuthHeader(admin.token) });

  async function sendSupport(device: ClientDevice = sender, message = 'お問い合わせ') {
    const response = await app.inject({
      method: 'POST', url: '/api/kiosk/support', headers: headers(device),
      payload: { message, page: '/kiosk/borrow' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requestId: expect.any(String), threadId: expect.any(String) });
    const thread = await prisma.kioskInquiryThread.findFirstOrThrow({
      where: { senderClientDeviceId: device.id }, orderBy: { createdAt: 'desc' }, include: { messages: true }
    });
    expect(response.json().threadId).toBe(thread.id);
    return thread;
  }

  it('support creates the first sender message, keeps the log and increases receiver summary', async () => {
    const before = (await summary(receiver)).json().unreadCount;
    const thread = await sendSupport();
    expect(thread).toMatchObject({ page: '/kiosk/borrow', receiverUnread: true, senderUnread: false });
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ side: 'SENDER', body: 'お問い合わせ', authorClientDeviceId: sender.id, authorEmployeeId: null });
    expect((await summary(receiver)).json()).toEqual({ isReceiver: true, unreadCount: before + 1, loginUnlock: false });
    expect((await summary(sender)).json()).toEqual({ isReceiver: false, unreadCount: 0, loginUnlock: false });
    expect(await prisma.clientLog.count({ where: { clientId: sender.id, message: { contains: '[SUPPORT]' } } })).toBe(1);
    expect(sendSlackNotification).toHaveBeenCalledOnce();
  });

  it('deleting the sender device cascades its threads and messages', async () => {
    const thread = await sendSupport();
    await prisma.clientDevice.delete({ where: { id: sender.id } });
    expect(await prisma.kioskInquiryThread.count({ where: { id: thread.id } })).toBe(0);
    expect(await prisma.kioskInquiryMessage.count({ where: { threadId: thread.id } })).toBe(0);
  });

  it('sender summary counts only its own unread reply threads', async () => {
    const own = await sendSupport();
    const other = await sendSupport(otherSender);
    await reply(receiver, own.id, { ...tag(), body: '返信1' });
    await reply(receiver, own.id, { ...tag(), body: '返信2' });
    await reply(receiver, other.id, { ...tag(), body: '別端末への返信' });
    expect((await summary(sender)).json()).toEqual({ isReceiver: false, unreadCount: 1, loginUnlock: false });
    await open(sender, own.id);
    expect((await summary(sender)).json().unreadCount).toBe(0);
    expect((await summary(otherSender)).json().unreadCount).toBe(1);
  });

  it.each(['list', 'open', 'reply'] as const)('receiver requires an employee tag for %s', async (action) => {
    const thread = await sendSupport();
    const response = action === 'list' ? await list(receiver)
      : action === 'open' ? await open(receiver, thread.id)
      : await reply(receiver, thread.id, { body: '返信' });
    expect(response.statusCode).toBe(401);
    expect(response.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED');
  });

  it('ADMIN can list, open and reply without a card or an employee author', async () => {
    const thread = await sendSupport();
    const listed = await list(receiver, {}, admin.token);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: thread.id })]));
    const opened = await open(receiver, thread.id, {}, admin.token);
    expect(opened.statusCode).toBe(200);
    expect(opened.json().thread.unread).toBe(false);
    const replied = await reply(receiver, thread.id, { body: '対応します' }, admin.token);
    expect(replied.statusCode).toBe(200);
    expect(replied.json().messages[1]).toMatchObject({ side: 'RECEIVER', body: '対応します', authorDisplayName: null });
    expect(await prisma.kioskInquiryMessage.findFirst({ where: { threadId: thread.id, side: 'RECEIVER' } })).toMatchObject({
      authorEmployeeId: null, authorClientDeviceId: receiver.id
    });
  });

  it('MANAGER can list receiver inquiries without a card', async () => {
    const thread = await sendSupport();
    const response = await list(receiver, {}, manager.token);
    expect(response.statusCode).toBe(200);
    expect(response.json().threads).toEqual(expect.arrayContaining([expect.objectContaining({ id: thread.id })]));
  });

  it.each(['viewer', 'invalid'] as const)('requires a card with a %s token on all protected actions', async kind => {
    const thread = await sendSupport();
    const token = kind === 'viewer' ? viewer.token : 'invalid-token';
    for (const response of [
      await list(receiver, {}, token),
      await open(receiver, thread.id, {}, token),
      await reply(receiver, thread.id, { body: '返信' }, token)
    ]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED');
    }
  });

  it('accepts a valid card despite an invalid token on all protected actions', async () => {
    const thread = await sendSupport();
    expect((await list(receiver, tag(), 'invalid-token')).statusCode).toBe(200);
    expect((await open(receiver, thread.id, tag(), 'invalid-token')).statusCode).toBe(200);
    const response = await reply(receiver, thread.id, { ...tag(), body: '返信' }, 'invalid-token');
    expect(response.statusCode).toBe(200);
    expect(response.json().messages[1].authorDisplayName).toBe(allowedEmployee.displayName);
  });

  it('does not let ADMIN override an unauthorized card', async () => {
    const thread = await sendSupport();
    const payload = { employeeTagUid: deniedEmployee.nfcTagUid! };
    for (const response of [
      await list(receiver, payload, admin.token),
      await open(receiver, thread.id, payload, admin.token),
      await reply(receiver, thread.id, { ...payload, body: '返信' }, admin.token)
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED');
    }
  });

  it('summary exposes login unlock only to ADMIN and MANAGER on receivers', async () => {
    for (const [device, token, loginUnlock] of [
      [receiver, admin.token, true], [receiver, manager.token, true],
      [receiver, undefined, false], [receiver, 'invalid-token', false],
      [receiver, viewer.token, false], [sender, admin.token, false]
    ] as const) {
      const response = await summary(device, token);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ isReceiver: device.id === receiver.id, loginUnlock });
    }
  });

  it('ADMIN still needs a client key and cannot access threads from other sender devices', async () => {
    const thread = await sendSupport(otherSender);
    expect((await list(sender, {}, admin.token)).json().threads).toEqual([]);
    for (const response of [
      await open(sender, thread.id, {}, admin.token),
      await reply(sender, thread.id, { body: '返信' }, admin.token)
    ]) expect(response.statusCode).toBe(404);
    for (const [method, url, payload] of [
      ['GET', '/api/kiosk/inquiries/summary', undefined],
      ['POST', '/api/kiosk/inquiries/list', {}],
      ['POST', `/api/kiosk/inquiries/${thread.id}/open`, {}],
      ['POST', `/api/kiosk/inquiries/${thread.id}/reply`, { body: '返信' }]
    ] as const) {
      const response = await app.inject({ method, url, payload, headers: createAuthHeader(admin.token) });
      expect(response.statusCode).toBe(401);
    }
  });

  it('list and open without a body require a receiver tag but allow the sender', async () => {
    const thread = await sendSupport();
    for (const device of [sender, receiver]) {
      for (const url of ['/api/kiosk/inquiries/list', `/api/kiosk/inquiries/${thread.id}/open`]) {
        const response = await app.inject({ method: 'POST', url, headers: headers(device) });
        expect(response.statusCode).toBe(device.id === receiver.id ? 401 : 200);
        if (device.id === receiver.id) {
          expect(response.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_TAG_REQUIRED');
        }
      }
    }
  });

  it.each(['unregistered', 'denied', 'inactive', 'suspended'] as const)('rejects %s employee tags uniformly on all protected actions', async (kind) => {
    const thread = await sendSupport();
    const employeeTagUid = kind === 'unregistered' ? 'UNREGISTERED_TAG'
      : kind === 'denied' ? deniedEmployee.nfcTagUid!
      : kind === 'inactive' ? inactiveEmployee.nfcTagUid! : suspendedEmployee.nfcTagUid!;
    for (const response of [
      await list(receiver, { employeeTagUid }),
      await open(receiver, thread.id, { employeeTagUid }),
      await reply(receiver, thread.id, { employeeTagUid, body: '返信' })
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_NOT_ALLOWED');
      expect(JSON.stringify(response.json())).not.toContain(employeeTagUid);
    }
    expect((await prisma.kioskInquiryThread.findUniqueOrThrow({ where: { id: thread.id } })).receiverUnread).toBe(true);
  });

  it('allowed receiver can list, open and reply; sender can read and append without a tag', async () => {
    const thread = await sendSupport();
    const listed = await list(receiver, tag());
    expect(listed.statusCode).toBe(200);
    expect(listed.json().threads.find((entry: { id: string }) => entry.id === thread.id)).toMatchObject({
      id: thread.id, senderClientDeviceName: sender.name, senderLocation: sender.location,
      page: thread.page, unread: true, lastMessage: { side: 'SENDER', body: 'お問い合わせ' }
    });
    const opened = await open(receiver, thread.id, tag());
    expect(opened.statusCode).toBe(200);
    expect(opened.json().thread.unread).toBe(false);
    expect(opened.json().messages[0]).not.toHaveProperty('authorDisplayName');
    expect((await prisma.kioskInquiryThread.findUniqueOrThrow({ where: { id: thread.id } })).receiverUnread).toBe(false);
    vi.mocked(sendSlackNotification).mockClear();
    const replied = await reply(receiver, thread.id, { ...tag(), body: '対応します' });
    expect(replied.statusCode).toBe(200);
    expect(replied.json().messages[1]).toMatchObject({ side: 'RECEIVER', body: '対応します', authorDisplayName: allowedEmployee.displayName });
    expect(sendSlackNotification).not.toHaveBeenCalled();
    expect(await prisma.kioskInquiryMessage.findFirst({ where: { threadId: thread.id, side: 'RECEIVER' } })).toMatchObject({
      authorEmployeeId: allowedEmployee.id, authorClientDeviceId: receiver.id
    });
    expect((await summary(sender)).json().unreadCount).toBe(1);
    expect((await list(sender)).json().threads[0].unread).toBe(true);
    const senderOpened = await open(sender, thread.id);
    expect(senderOpened.statusCode).toBe(200);
    expect(senderOpened.json().thread.unread).toBe(false);
    expect((await summary(sender)).json().unreadCount).toBe(0);
    const appended = await reply(sender, thread.id, { body: 'ありがとうございます' });
    expect(appended.statusCode).toBe(200);
    expect(appended.json().messages.map((message: { side: string }) => message.side)).toEqual(['SENDER', 'RECEIVER', 'SENDER']);
    expect(appended.json().thread.lastMessage).toMatchObject({ side: 'SENDER', body: 'ありがとうございます' });
    expect(appended.json().thread.lastMessageAt).toBe(appended.json().messages[2].createdAt);
    expect(await prisma.kioskInquiryThread.findUniqueOrThrow({ where: { id: thread.id } })).toMatchObject({ receiverUnread: true, senderUnread: false });
    expect(sendSlackNotification).toHaveBeenCalledWith(expect.objectContaining({ clientId: sender.id, page: thread.page, message: 'ありがとうございます' }));
  });

  it.each(['other-device', 'missing'] as const)('sender cannot open or reply to %s threads', async (kind) => {
    const thread = await sendSupport(otherSender);
    const id = kind === 'missing' ? randomUUID() : thread.id;
    for (const response of [await open(sender, id), await reply(sender, id, { body: '追記' })]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().errorCode).toBe('KIOSK_INQUIRY_NOT_FOUND');
    }
    expect((await list(sender)).json().threads).toEqual([]);
    expect(await prisma.kioskInquiryMessage.count({ where: { threadId: thread.id } })).toBe(1);
  });

  it('authorized receiver gets 404 for missing threads', async () => {
    for (const response of [await open(receiver, randomUUID(), tag()), await reply(receiver, randomUUID(), { ...tag(), body: '返信' })]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().errorCode).toBe('KIOSK_INQUIRY_NOT_FOUND');
    }
  });

  it('summary and repeated views do not consume the support rate limit', async () => {
    const thread = await sendSupport();
    for (let index = 0; index < 5; index++) {
      expect((await summary(receiver)).statusCode).toBe(200);
      expect((await list(sender)).statusCode).toBe(200);
      expect((await open(sender, thread.id)).statusCode).toBe(200);
    }
    await sendSupport(sender, '2件目');
    await sendSupport(sender, '3件目');
  });

  it('list limits and lastMessageAt descending order apply to each device role', async () => {
    const now = Date.now();
    const threads = Array.from({ length: 51 }, (_, index) => ({
      id: randomUUID(), senderClientDeviceId: sender.id, page: '/kiosk', lastMessageAt: new Date(now + index)
    }));
    await prisma.kioskInquiryThread.createMany({ data: threads });
    await prisma.kioskInquiryMessage.createMany({
      data: threads.map((thread, index) => ({
        threadId: thread.id, side: 'SENDER' as const, body: String(index), authorClientDeviceId: sender.id, createdAt: thread.lastMessageAt
      }))
    });
    const own = (await list(sender)).json().threads;
    const all = (await list(receiver, tag())).json().threads;
    expect(own).toHaveLength(20);
    expect(all).toHaveLength(50);
    expect(own.map((thread: { id: string }) => thread.id)).toEqual(threads.slice(-20).reverse().map(({ id }) => id));
    expect(all.map((thread: { lastMessageAt: string }) => thread.lastMessageAt)).toEqual(
      [...all].map((thread: { lastMessageAt: string }) => thread.lastMessageAt).sort().reverse()
    );
  });

  it.each([{ label: 'empty', body: '' }, { label: 'too long', body: 'x'.repeat(1001) }])('rejects $label reply bodies', async ({ body }) => {
    const thread = await sendSupport();
    expect((await reply(sender, thread.id, { body })).statusCode).toBe(400);
    expect(await prisma.kioskInquiryMessage.count({ where: { threadId: thread.id } })).toBe(1);
  });

  it('accepts 1000-character replies and rejects unknown body fields', async () => {
    const thread = await sendSupport();
    expect((await reply(sender, thread.id, { body: 'x'.repeat(1000) })).statusCode).toBe(200);
    expect((await reply(sender, thread.id, { body: '追記', unexpected: true })).statusCode).toBe(400);
    expect((await list(sender, { unexpected: true })).statusCode).toBe(400);
    expect((await open(sender, thread.id, { unexpected: true })).statusCode).toBe(400);
  });

  it('kiosk endpoints require a valid client key', async () => {
    for (const key of [undefined, 'invalid-client-key']) {
      const response = await app.inject({
        method: 'GET', url: '/api/kiosk/inquiries/summary', headers: key ? { 'x-client-key': key } : {}
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it('GET and PUT settings replace all receivers, deduplicate inputs and return sorted display data', async () => {
    const response = await putSettings({
      receiverClientDeviceIds: [sender.id, sender.id],
      employeeCodes: [deniedEmployee.employeeCode, allowedEmployee.employeeCode, allowedEmployee.employeeCode]
    });
    expect(response.statusCode).toBe(200);
    const settings = response.json().settings;
    expect(settings.devices.filter((device: { inquiryReceiverEnabled: boolean }) => device.inquiryReceiverEnabled).map((device: { id: string }) => device.id)).toEqual([sender.id]);
    // The database collation decides the order, so compare with the database, not with a JS sort.
    const devicesByName = await prisma.clientDevice.findMany({ orderBy: { name: 'asc' }, select: { name: true } });
    expect(settings.devices.map((device: { name: string }) => device.name)).toEqual(devicesByName.map(device => device.name));
    expect(settings.employees).toEqual([allowedEmployee, deniedEmployee]
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
      .map((employee) => ({ employeeId: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName, canViewScreen: false })));
    expect((await getSettings()).json()).toEqual(response.json());
    const cleared = await putSettings({ receiverClientDeviceIds: [], employeeCodes: [] });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().settings.employees).toEqual([]);
    expect(cleared.json().settings.devices.every((device: { inquiryReceiverEnabled: boolean }) => !device.inquiryReceiverEnabled)).toBe(true);
  });

  it.each([true, false])('persists canViewScreen=%s and exposes it only to badge-authorized receivers', async canViewScreen => {
    const saved = await putSettings({
      receiverClientDeviceIds: [receiver.id],
      employees: [{ employeeCode: allowedEmployee.employeeCode, canViewScreen }]
    });
    expect(saved.statusCode).toBe(200);
    const fetched = await getSettings();
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().settings.employees).toEqual([{
      employeeId: allowedEmployee.id, employeeCode: allowedEmployee.employeeCode,
      displayName: allowedEmployee.displayName, canViewScreen
    }]);
    const thread = await sendSupport();
    for (const [device, payload, token, expected] of [
      [receiver, tag(), undefined, canViewScreen],
      [receiver, {}, admin.token, false],
      [receiver, {}, manager.token, false],
      [sender, {}, undefined, false],
      [sender, tag(), undefined, false]
    ] as const) {
      const listed = await list(device, payload, token);
      const opened = await open(device, thread.id, payload, token);
      expect(listed.statusCode).toBe(200);
      expect(opened.statusCode).toBe(200);
      expect(listed.json().canViewScreen).toBe(expected);
      expect(opened.json().canViewScreen).toBe(expected);
      for (const presented of [listed.json().threads.find((entry: { id: string }) => entry.id === thread.id), opened.json().thread]) {
        expect(presented).not.toHaveProperty('senderClientDeviceId');
        expect(presented).not.toHaveProperty('canViewScreen');
      }
    }
    // A legacy save must revoke any previously enabled screen-view permission.
    const legacy = await putSettings({ receiverClientDeviceIds: [receiver.id], employeeCodes: [allowedEmployee.employeeCode] });
    expect(legacy.statusCode).toBe(200);
    expect((await getSettings()).json().settings.employees[0].canViewScreen).toBe(false);
  });

  it.each([true, false])('prefers employees over employeeCodes and the last duplicate permission (%s)', async canViewScreen => {
    const response = await putSettings({
      receiverClientDeviceIds: [receiver.id],
      employeeCodes: [deniedEmployee.employeeCode],
      employees: [
        { employeeCode: allowedEmployee.employeeCode, canViewScreen: !canViewScreen },
        { employeeCode: allowedEmployee.employeeCode, canViewScreen }
      ]
    });
    expect(response.statusCode).toBe(200);
    expect((await getSettings()).json().settings.employees).toEqual([{
      employeeId: allowedEmployee.id, employeeCode: allowedEmployee.employeeCode,
      displayName: allowedEmployee.displayName, canViewScreen
    }]);
    const cleared = await putSettings({
      receiverClientDeviceIds: [receiver.id], employeeCodes: [allowedEmployee.employeeCode], employees: []
    });
    expect(cleared.statusCode).toBe(200);
    expect((await getSettings()).json().settings.employees).toEqual([]);
  });

  it.each([
    {},
    { employees: [{ employeeCode: '0012' }] },
    { employees: [{ employeeCode: '0012', canViewScreen: 'true' }] },
    { employees: [{ employeeCode: '0012', canViewScreen: true, extra: true }] }
  ])('rejects invalid employee permissions: %j', async payload => {
    const before = (await getSettings()).json();
    expect((await putSettings({ receiverClientDeviceIds: [], ...payload })).statusCode).toBe(400);
    expect((await getSettings()).json()).toEqual(before);
  });

  it.each(['employee', 'device'] as const)('unknown %s settings values return 400 and leave everything unchanged', async (kind) => {
    const before = (await getSettings()).json();
    const missing = kind === 'employee' ? 'missing-employee-code' : randomUUID();
    const response = await putSettings({
      receiverClientDeviceIds: kind === 'device' ? [sender.id, missing] : [sender.id],
      employeeCodes: kind === 'employee' ? [allowedEmployee.employeeCode, missing] : [allowedEmployee.employeeCode]
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe(kind === 'employee' ? 'KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND' : 'KIOSK_INQUIRY_CLIENT_DEVICE_NOT_FOUND');
    expect(response.json().details).toEqual([missing]);
    expect((await getSettings()).json()).toEqual(before);
  });

  it('employee lookup resolves codes to employee IDs and names, or returns 404', async () => {
    const found = await app.inject({ method: 'GET', url: `${settingsUrl}/employee-lookup?employeeCode=${allowedEmployee.employeeCode}`, headers: createAuthHeader(admin.token) });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ employee: { employeeId: allowedEmployee.id, employeeCode: allowedEmployee.employeeCode, displayName: allowedEmployee.displayName, canViewScreen: false } });
    const missing = await app.inject({ method: 'GET', url: `${settingsUrl}/employee-lookup?employeeCode=missing-code`, headers: createAuthHeader(admin.token) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().errorCode).toBe('KIOSK_INQUIRY_EMPLOYEE_CODE_NOT_FOUND');
  });

  it.each(['GET', 'PUT', 'lookup'] as const)('settings %s require ADMIN or MANAGER authorization', async (action) => {
    for (const role of ['anonymous', 'viewer', 'manager'] as const) {
      const response = await app.inject({
        method: action === 'PUT' ? 'PUT' : 'GET',
        url: action === 'lookup' ? `${settingsUrl}/employee-lookup?employeeCode=${allowedEmployee.employeeCode}` : settingsUrl,
        headers: role === 'anonymous' ? {} : createAuthHeader(role === 'viewer' ? viewer.token : manager.token),
        ...(action === 'PUT' ? { payload: { receiverClientDeviceIds: [], employeeCodes: [] } } : {})
      });
      expect(response.statusCode).toBe(role === 'anonymous' ? 401 : role === 'viewer' ? 403 : 200);
    }
  });

  it('management inputs are strict', async () => {
    expect((await putSettings({ receiverClientDeviceIds: [], employeeCodes: [], extra: true })).statusCode).toBe(400);
    const response = await app.inject({
      method: 'GET', url: `${settingsUrl}/employee-lookup?employeeCode=${allowedEmployee.employeeCode}&extra=true`, headers: createAuthHeader(admin.token)
    });
    expect(response.statusCode).toBe(400);
  });
});
