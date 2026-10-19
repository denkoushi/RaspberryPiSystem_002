import type { ClientDevice, Employee } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { kioskScreenWatchService } from '../../services/kiosk-screen-watch/kiosk-screen-watch.service.js';
import { signalingRegistry } from '../../services/kiosk-screen-watch/signaling-registry.js';
import { createTestClientDevice, createTestEmployee } from './helpers.js';

// Requires a migrated PostgreSQL database; intentionally separate from the no-DB state tests.
describe('screen watch HTTP and persistence', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let target: ClientDevice;
  let viewer: ClientDevice;
  let employee: Employee;
  let threadId: string;
  const targetSocket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  const viewerSocket = { readyState: 1, send: vi.fn(), close: vi.fn() };

  beforeAll(async () => { app = await buildServer(); });
  beforeEach(async () => {
    target = await createTestClientDevice();
    viewer = await createTestClientDevice();
    viewer = await prisma.clientDevice.update({ where: { id: viewer.id }, data: { inquiryReceiverEnabled: true, name: 'StoneBase01' } });
    employee = await createTestEmployee();
    await prisma.kioskInquiryReceiverEmployee.create({ data: { employeeId: employee.id, canViewScreen: true } });
    threadId = (await prisma.kioskInquiryThread.create({ data: { senderClientDeviceId: target.id, page: '/kiosk', lastMessageAt: new Date() } })).id;
    targetSocket.send.mockClear(); viewerSocket.send.mockClear();
  });
  afterEach(async () => {
    await signalingRegistry.disconnect(`test-target-${target.id}`, targetSocket);
    await signalingRegistry.disconnect(`test-viewer-${viewer.id}`, viewerSocket);
    await prisma.kioskInquiryThread.deleteMany({ where: { id: threadId } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.clientDevice.deleteMany({ where: { id: { in: [target.id, viewer.id] } } });
  });
  afterAll(async () => { await app?.close(); });
  const post = () => app.inject({ method: 'POST', url: `/api/kiosk/inquiries/${threadId}/watch`,
    headers: { 'x-client-key': viewer.apiKey }, payload: { employeeTagUid: employee.nfcTagUid! } });
  const connect = async () => {
    await signalingRegistry.register(`test-target-${target.id}`, target.id, targetSocket);
    await signalingRegistry.register(`test-viewer-${viewer.id}`, viewer.id, viewerSocket);
  };

  it('403 when the badge lacks screen permission', async () => {
    await prisma.kioskInquiryReceiverEmployee.update({ where: { employeeId: employee.id }, data: { canViewScreen: false } });
    const response = await post();
    expect(response.statusCode).toBe(403); expect(response.json().errorCode).toBe('KIOSK_SCREEN_WATCH_NOT_ALLOWED');
  });
  it('403 for a badge outside the receiver allowlist', async () => {
    await prisma.kioskInquiryReceiverEmployee.delete({ where: { employeeId: employee.id } });
    expect((await post()).statusCode).toBe(403);
  });
  it('409 when the sender is offline', async () => {
    const response = await post();
    expect(response.statusCode).toBe(409); expect(response.json().errorCode).toBe('KIOSK_SCREEN_WATCH_TARGET_OFFLINE');
  });
  it('409 when only the viewer is offline', async () => {
    await signalingRegistry.register(`test-target-${target.id}`, target.id, targetSocket);
    const response = await post();
    expect(response.statusCode).toBe(409); expect(response.json().errorCode).toBe('KIOSK_SCREEN_WATCH_VIEWER_OFFLINE');
  });
  it.each(['REQUESTED', 'ACTIVE'] as const)('replaces a stale persisted %s session', async status => {
    await connect();
    const stale = await prisma.kioskScreenWatchSession.create({ data: {
      threadId, viewerClientDeviceId: viewer.id, targetClientDeviceId: target.id, status
    } });
    expect((await post()).statusCode).toBe(200);
    expect(await prisma.kioskScreenWatchSession.findUnique({ where: { id: stale.id } })).toMatchObject({ status: 'ENDED', endReason: 'stale' });
    const messages = await prisma.kioskInquiryMessage.findMany({ where: { threadId } });
    expect(messages.map(m => m.body)).toEqual(status === 'ACTIVE' ? ['見るのを止めました'] : []);
  });
  it('200 delivers a request to a registered device and returns only watchId', async () => {
    await connect(); const response = await post();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ watchId: expect.any(String) });
    expect(JSON.parse(targetSocket.send.mock.calls[0][0])).toEqual({ type: 'watch.request', payload: { watchId: response.json().watchId, viewerName: 'StoneBase01' } });
    expect(await prisma.kioskScreenWatchSession.findUnique({ where: { id: response.json().watchId } })).toMatchObject({
      status: 'REQUESTED', viewerEmployeeId: employee.id, viewerClientDeviceId: viewer.id, targetClientDeviceId: target.id
    });
  });
  it.each([false, true])('409 while target is busy (active=%s)', async active => {
    await connect(); const { watchId } = (await post()).json();
    if (active) await kioskScreenWatchService.handle(target.id, { type: 'watch.accept', payload: { watchId } });
    const response = await post();
    expect(response.statusCode).toBe(409); expect(response.json().errorCode).toBe('KIOSK_SCREEN_WATCH_BUSY');
  });
  it('enforces the live-target constraint in PostgreSQL and releases it on denial', async () => {
    await connect(); const { watchId } = (await post()).json();
    const data = { threadId, viewerClientDeviceId: viewer.id, targetClientDeviceId: target.id };
    await expect(prisma.kioskScreenWatchSession.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    await kioskScreenWatchService.handle(target.id, { type: 'watch.deny', payload: { watchId } });
    expect((await post()).statusCode).toBe(200);
  });
  it('rejects a system notice even with permission', async () => {
    await prisma.kioskInquiryThread.update({ where: { id: threadId }, data: { kind: 'SYSTEM_NOTICE', senderClientDeviceId: null } });
    expect((await post()).statusCode).toBe(404);
  });
  it('persists SYSTEM messages and audit dates for accept and stop', async () => {
    await connect(); const { watchId } = (await post()).json();
    await kioskScreenWatchService.handle(target.id, { type: 'watch.accept', payload: { watchId } });
    await kioskScreenWatchService.handle(viewer.id, { type: 'watch.stop', payload: { watchId } });
    const session = await prisma.kioskScreenWatchSession.findUniqueOrThrow({ where: { id: watchId } });
    expect(session).toMatchObject({ status: 'ENDED', acceptedAt: expect.any(Date), endedAt: expect.any(Date), endReason: 'viewer' });
    const messages = await prisma.kioskInquiryMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
    expect(messages.map(m => [m.side, m.body])).toEqual([['SYSTEM', '画面を見ています'], ['SYSTEM', '見るのを止めました']]);
  });
});
