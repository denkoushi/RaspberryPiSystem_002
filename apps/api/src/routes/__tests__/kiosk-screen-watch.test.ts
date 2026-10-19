import { randomUUID } from 'node:crypto';
import type { KioskScreenWatchSession, PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskScreenWatchService } from '../../services/kiosk-screen-watch/kiosk-screen-watch.service.js';
import { SignalingRegistry } from '../../services/kiosk-screen-watch/signaling-registry.js';

const auth = vi.hoisted(() => vi.fn());
vi.mock('../../services/kiosk-inquiry/kiosk-inquiry.service.js', () => ({ authorizeReceiver: auth }));

const viewer = { id: 'viewer-device', name: 'StoneBase01', inquiryReceiverEnabled: true, systemNoticeReceiverEnabled: false };
const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn() });
const messages = (s: ReturnType<typeof socket>) => s.send.mock.calls.map(([data]) => JSON.parse(data));
let registry: SignalingRegistry;
let service: KioskScreenWatchService;
let targetSocket: ReturnType<typeof socket>;
let viewerSocket: ReturnType<typeof socket>;
let sessions: KioskScreenWatchSession[];
let audit: string[];
let db: PrismaClient;

beforeEach(async () => {
  vi.useFakeTimers();
  auth.mockReset().mockResolvedValue({ employeeId: 'employee', canViewScreen: true });
  sessions = []; audit = [];
  const table = {
    findUnique: vi.fn(async ({ where }) => sessions.find(s => s.id === where.id) ?? null),
    findFirst: vi.fn(async ({ where }) => sessions.find(s => s.targetClientDeviceId === where.targetClientDeviceId && where.status.in.includes(s.status)) ?? null),
    findMany: vi.fn(async ({ where }) => sessions.filter(s => where.status.in.includes(s.status) &&
      (!where.targetClientDeviceId || s.targetClientDeviceId === where.targetClientDeviceId) &&
      (!where.OR || where.OR.some((part: Record<string, string>) => Object.entries(part).every(([k, v]) => s[k as keyof KioskScreenWatchSession] === v))))),
    create: vi.fn(async ({ data }) => {
      const session = { id: randomUUID(), status: 'REQUESTED', acceptedAt: null, endedAt: null, endReason: null, ...data };
      sessions.push(session); return { ...session };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const index = sessions.findIndex(s => s.id === where.id && s.status === where.status);
      if (index < 0) return { count: 0 };
      sessions[index] = { ...sessions[index], ...data }; return { count: 1 };
    })
  };
  const fake = {
    kioskScreenWatchSession: table,
    kioskInquiryThread: {
      findUnique: vi.fn(async () => ({ id: 'thread', kind: 'INQUIRY', senderClientDeviceId: 'target-device' })),
      update: vi.fn(async ({ data }) => { audit.push(data.messages.create.body); })
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(fake))
  };
  db = fake as unknown as PrismaClient;
  registry = new SignalingRegistry();
  service = new KioskScreenWatchService(db, registry);
  targetSocket = socket(); viewerSocket = socket();
  // Deliberately different IDs: never route watch by a signaling identifier.
  await registry.register('target-signal-id', 'target-device', targetSocket);
  await registry.register('viewer-signal-id', viewer.id, viewerSocket);
});
afterEach(() => { service.dispose(); vi.useRealTimers(); });
const request = () => service.request(viewer, 'thread', 'badge');
const handle = (type: string, watchId: string, device = 'target-device', extra = {}) => service.handle(device, { type, payload: { watchId, ...extra } });

describe('screen watch state machine (no database)', () => {
  it('routes by device, records the viewer, and does not expose device IDs', async () => {
    const result = await request();
    expect(result).toEqual({ watchId: expect.any(String) });
    expect(messages(targetSocket)).toEqual([{ type: 'watch.request', payload: { watchId: result.watchId, viewerName: 'StoneBase01' } }]);
    expect(sessions[0]).toMatchObject({ viewerEmployeeId: 'employee', viewerClientDeviceId: viewer.id, targetClientDeviceId: 'target-device', status: 'REQUESTED' });
  });
  it('requires permission', async () => {
    auth.mockResolvedValue({ employeeId: 'employee', canViewScreen: false });
    await expect(request()).rejects.toMatchObject({ statusCode: 403, code: 'KIOSK_SCREEN_WATCH_NOT_ALLOWED' });
    expect(sessions).toHaveLength(0);
  });
  it('rejects an offline target', async () => {
    targetSocket.readyState = 3;
    await expect(request()).rejects.toMatchObject({ statusCode: 409, code: 'KIOSK_SCREEN_WATCH_TARGET_OFFLINE' });
  });
  it('allows only one concurrent live request per target', async () => {
    const results = await Promise.allSettled([request(), request()]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'KIOSK_SCREEN_WATCH_BUSY' } });
    expect(sessions).toHaveLength(1);
  });
  it.each(['target-device', 'viewer-device'])('accepts and stops from %s, auditing exactly once', async device => {
    const { watchId } = await request();
    await handle('watch.accept', watchId);
    expect(sessions[0]).toMatchObject({ status: 'ACTIVE', acceptedAt: expect.any(Date) });
    expect(messages(viewerSocket).at(-1)).toEqual({ type: 'watch.accepted', payload: { watchId } });
    await handle('watch.stop', watchId, device);
    expect(sessions[0]).toMatchObject({ status: 'ENDED', endedAt: expect.any(Date), endReason: device === viewer.id ? 'viewer' : 'target' });
    expect(messages(device === viewer.id ? targetSocket : viewerSocket).at(-1)?.type).toBe('watch.stopped');
    await expect(handle('watch.stop', watchId, device)).rejects.toThrow('ended');
    expect(audit).toEqual(['画面を見ています', '見るのを止めました']);
  });
  it.each(['target-device', 'viewer-device'])('cancels a pending request from %s without SYSTEM messages', async device => {
    const { watchId } = await request();
    await handle('watch.stop', watchId, device);
    expect(sessions[0].status).toBe('ENDED'); expect(audit).toEqual([]);
  });
  it('denies without a SYSTEM message and cancels its timer', async () => {
    const { watchId } = await request(); await handle('watch.deny', watchId);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sessions[0]).toMatchObject({ status: 'DENIED', endedAt: expect.any(Date) });
    expect(messages(viewerSocket)).toEqual([{ type: 'watch.denied', payload: { watchId } }]); expect(audit).toEqual([]);
  });
  it('expires after 60 seconds and notifies both parties', async () => {
    const { watchId } = await request();
    await vi.advanceTimersByTimeAsync(59_999); expect(sessions[0].status).toBe('REQUESTED');
    await vi.advanceTimersByTimeAsync(1); expect(sessions[0]).toMatchObject({ status: 'EXPIRED', endReason: 'timeout' });
    for (const s of [targetSocket, viewerSocket]) expect(messages(s).at(-1)).toEqual({ type: 'watch.stopped', payload: { watchId, reason: 'timeout' } });
    expect(audit).toEqual([]);
  });
  it.each(['target', 'viewer'])('ends an active watch on %s disconnect', async party => {
    const { watchId } = await request(); await handle('watch.accept', watchId);
    await registry.disconnect(`${party}-signal-id`, party === 'target' ? targetSocket : viewerSocket);
    expect(sessions[0]).toMatchObject({ status: 'ENDED', endReason: 'disconnect' });
    expect(audit).toEqual(['画面を見ています', '見るのを止めました']);
    expect(messages(party === 'target' ? viewerSocket : targetSocket).at(-1)?.payload.reason).toBe('disconnect');
  });
  it('ends a pending watch on disconnect without audit messages', async () => {
    await request(); await registry.disconnect('target-signal-id', targetSocket);
    expect(sessions[0].status).toBe('ENDED'); expect(audit).toEqual([]);
  });
  it.each(['watch.accept', 'watch.deny', 'watch.stop', 'watch.fail', 'watch.signal', 'watch.pointer'])('rejects wrong party for %s', async type => {
    const { watchId } = await request();
    await expect(handle(type, watchId, 'unrelated-device')).rejects.toThrow('Unauthorized');
    expect(sessions[0].status).toBe('REQUESTED'); expect(audit).toEqual([]);
  });
  it.each(['watch.accept', 'watch.deny', 'watch.fail'])('rejects viewer sending %s', async type => {
    const { watchId } = await request(); await expect(handle(type, watchId, viewer.id)).rejects.toThrow();
    expect(sessions[0].status).toBe('REQUESTED');
  });
  it('records capture failure, forwards its reason, and clears the timeout', async () => {
    const { watchId } = await request(); await handle('watch.fail', watchId, 'target-device', { reason: 'NotAllowedError' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sessions[0]).toMatchObject({ status: 'FAILED', endReason: 'NotAllowedError' });
    expect(messages(viewerSocket).at(-1)).toEqual({ type: 'watch.stopped', payload: { watchId, reason: 'NotAllowedError' } });
  });
  it('forwards signal while requested, and pointer only while active, unchanged', async () => {
    const { watchId } = await request();
    const signal = { type: 'watch.signal', payload: { watchId, signal: { type: 'offer', sdp: 'future' } } };
    await service.handle(viewer.id, signal); expect(messages(targetSocket).at(-1)).toEqual(signal);
    await expect(handle('watch.pointer', watchId)).rejects.toThrow('not active');
    await handle('watch.accept', watchId);
    const pointer = { type: 'watch.pointer', payload: { watchId, x: .2, y: .8 } };
    await service.handle(viewer.id, pointer); expect(messages(targetSocket).at(-1)).toEqual(pointer);
    await handle('watch.stop', watchId);
    await expect(service.handle(viewer.id, signal)).rejects.toThrow('not active');
  });
  it('late consent expires even if the timer callback has not run yet', async () => {
    const { watchId } = await request(); vi.setSystemTime(Date.now() + 60_000);
    await handle('watch.accept', watchId); expect(sessions[0].status).toBe('EXPIRED'); expect(audit).toEqual([]);
  });
  it('replacing a socket ends the watch and late old close cannot remove the replacement', async () => {
    await request(); const replacement = socket();
    await registry.register('target-signal-id', 'target-device', replacement);
    expect(targetSocket.close).toHaveBeenCalledWith(1000, 'Replaced by new connection');
    expect(sessions[0].status).toBe('ENDED');
    await registry.disconnect('target-signal-id', targetSocket);
    expect(registry.sendToClientDevice('target-device', { type: 'watch.signal' })).toBe(true);
    expect(replacement.send).toHaveBeenCalledOnce();
  });
});


describe('process ownership and relay', () => {
  const restart = () => { service.dispose(); service = new KioskScreenWatchService(db, registry); };
  it.each(['REQUESTED', 'ACTIVE'] as const)('releases stale %s rows before the busy check', async status => {
    const { watchId } = await request();
    if (status === 'ACTIVE') await handle('watch.accept', watchId);
    restart();
    const next = await request();
    expect(next.watchId).not.toBe(watchId);
    expect(sessions[0]).toMatchObject({ status: 'ENDED', endReason: 'stale', endedAt: expect.any(Date) });
    expect(audit).toEqual(status === 'ACTIVE' ? ['画面を見ています', '見るのを止めました'] : []);
  });
  it.each(['watch.accept', 'watch.stop', 'watch.signal', 'watch.pointer'])('recovers stale rows on %s and notifies the sender', async type => {
    const { watchId } = await request();
    restart();
    await handle(type, watchId);
    expect(sessions[0]).toMatchObject({ status: 'ENDED', endReason: 'stale' });
    expect(messages(targetSocket).at(-1)).toEqual({ type: 'watch.stopped', payload: { watchId, reason: 'stale' } });
    expect(audit).toEqual([]);
  });
  it('does not let an unrelated sender end a stale row', async () => {
    const { watchId } = await request(); restart();
    await expect(handle('watch.stop', watchId, 'stranger')).rejects.toThrow('Unauthorized');
    expect(sessions[0].status).toBe('REQUESTED');
  });
  it('requires the viewer signaling socket to be online', async () => {
    viewerSocket.readyState = 3;
    await expect(request()).rejects.toMatchObject({ statusCode: 409, code: 'KIOSK_SCREEN_WATCH_VIEWER_OFFLINE' });
    expect(sessions).toHaveLength(0); expect(targetSocket.send).not.toHaveBeenCalled();
  });
  it('relays without any DB access or waiting behind a pending transition', async () => {
    const { watchId } = await request(); await handle('watch.accept', watchId);
    let unblock!: (value: unknown) => void;
    auth.mockReturnValueOnce(new Promise(resolve => { unblock = resolve; }));
    const blocked = request();
    await Promise.resolve();
    vi.clearAllMocks();
    for (let i = 0; i < 20; i++) {
      await handle('watch.signal', watchId, 'target-device', { candidate: { candidate: 'ice' } });
      await handle('watch.pointer', watchId, viewer.id, { x: .1, y: .9 });
    }
    expect(viewerSocket.send).toHaveBeenCalledTimes(20); expect(targetSocket.send).toHaveBeenCalledTimes(20);
    for (const fn of Object.values(db.kioskScreenWatchSession)) expect(fn).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    unblock({ employeeId: 'employee', canViewScreen: true });
    await expect(blocked).rejects.toMatchObject({ code: 'KIOSK_SCREEN_WATCH_BUSY' });
  });
  it.each(['watch.signal', 'watch.pointer'])('bounds %s payload JSON by UTF-8 bytes', async type => {
    const { watchId } = await request(); await handle('watch.accept', watchId);
    const payload = { watchId, x: .2, y: .4, padding: '' };
    payload.padding = 'a'.repeat(65536 - Buffer.byteLength(JSON.stringify(payload)));
    await service.handle(viewer.id, { type, payload });
    vi.clearAllMocks();
    await expect(service.handle(viewer.id, { type, payload: { ...payload, padding: payload.padding + 'あ' } })).rejects.toThrow('too large');
    expect(targetSocket.send).not.toHaveBeenCalled(); expect(db.kioskScreenWatchSession.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ x: -0.1, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: NaN }, { x: 0, y: Infinity }])('rejects invalid pointer %j', async point => {
    const { watchId } = await request(); await handle('watch.accept', watchId);
    await expect(handle('watch.pointer', watchId, viewer.id, point)).rejects.toThrow();
  });
  it('only the viewer can point', async () => {
    const { watchId } = await request(); await handle('watch.accept', watchId);
    await expect(handle('watch.pointer', watchId, 'target-device', { x: 0, y: 1 })).rejects.toThrow('Only viewer');
  });
});
