import type { KioskScreenWatchSession, KioskScreenWatchStatus, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { authorizeReceiver, type InquiryLoginUser } from '../kiosk-inquiry/kiosk-inquiry.service.js';
import { signalingRegistry, type SignalingRegistry, type SignalingEnvelope } from './signaling-registry.js';

const liveStatuses: KioskScreenWatchStatus[] = ['REQUESTED', 'ACTIVE'];
const watchIdSchema = z.object({ watchId: z.string().guid() });
const payloadSchema = watchIdSchema.extend({ reason: z.string().max(200).optional() }).passthrough();
const coordinate = z.number().finite().min(0).max(1);
const point = z.object({ x: coordinate, y: coordinate });
const inputPoint = watchIdSchema.extend(point.shape);
const inputSchema = z.discriminatedUnion('kind', [
  inputPoint.extend({ kind: z.literal('click') }),
  inputPoint.extend({ kind: z.literal('move') }),
  watchIdSchema.extend({ kind: z.literal('key'), key: z.union([
    z.string().length(1).regex(/^[\x20-\x7e]$/),
    z.enum(['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight'])
  ]) })
]);
const clock = {
  now: () => new Date(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer)
};
type ViewerDevice = { id: string; name: string; inquiryReceiverEnabled: boolean; systemNoticeReceiverEnabled: boolean };
type LiveSession = {
  viewerDeviceId: string;
  viewerName: string;
  targetDeviceId: string;
  threadId: string;
  status: KioskScreenWatchStatus;
  control: 'off' | 'requested' | 'on';
};

async function recordMessages(tx: Prisma.TransactionClient, threadId: string, now: Date, ...bodies: string[]) {
  // Inquiry messages are read in timestamp order.
  const messages = bodies.map((body, index) => ({
    side: 'SYSTEM' as const, body, createdAt: new Date(now.getTime() + index)
  }));
  await tx.kioskInquiryThread.update({ where: { id: threadId }, data: {
    lastMessageAt: messages.at(-1)?.createdAt ?? now, receiverUnread: true, senderUnread: true,
    messages: { create: messages }
  } });
}

export class KioskScreenWatchService {
  private liveSessions = new Map<string, LiveSession>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Serialize asynchronous transitions and notifications, including disconnect during request creation.
  private pending: Promise<unknown> = Promise.resolve();
  private unsubscribe: () => void;

  constructor(
    private db: PrismaClient,
    private registry: SignalingRegistry,
    private time = clock,
    private reportError: (error: unknown) => void = console.error
  ) {
    this.unsubscribe = registry.onDisconnect(deviceId => this.disconnected(deviceId));
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.catch(() => undefined);
    return result;
  }

  request(device: ViewerDevice, threadId: string, employeeTagUid?: string, loginUser?: InquiryLoginUser): Promise<{ watchId: string }> {
    return this.enqueue(async () => {
      const notAllowed = () => new ApiError(403, '画面を見る権限がありません', undefined, 'KIOSK_SCREEN_WATCH_NOT_ALLOWED');
      if (!device.inquiryReceiverEnabled || (!employeeTagUid && !loginUser)) throw notAllowed();
      const access = await authorizeReceiver(device, employeeTagUid, loginUser);
      if (!access.canViewScreen) throw notAllowed();
      const thread = await this.db.kioskInquiryThread.findUnique({ where: { id: threadId } });
      if (!thread || thread.kind !== 'INQUIRY' || !thread.senderClientDeviceId) {
        throw new ApiError(404, 'お問い合わせが見つかりません', undefined, 'KIOSK_INQUIRY_NOT_FOUND');
      }
      const targetClientDeviceId = thread.senderClientDeviceId;
      if (targetClientDeviceId === device.id) {
        throw new ApiError(403, '自分の画面は要求できません', undefined, 'KIOSK_SCREEN_WATCH_NOT_ALLOWED');
      }
      const offline = () => new ApiError(409, '相手の端末が つながっていません', undefined, 'KIOSK_SCREEN_WATCH_TARGET_OFFLINE');
      const busy = () => new ApiError(409, 'ほかの人が見ています', undefined, 'KIOSK_SCREEN_WATCH_BUSY');
      if (!this.registry.isOnline(targetClientDeviceId)) throw offline();
      if (!this.registry.isOnline(device.id)) {
        throw new ApiError(409, 'この端末が つながっていません', undefined, 'KIOSK_SCREEN_WATCH_VIEWER_OFFLINE');
      }
      const previous = await this.db.kioskScreenWatchSession.findMany({ where: { targetClientDeviceId, status: { in: liveStatuses } } });
      for (const row of previous) {
        if (!this.liveSessions.has(row.id)) await this.transition(row, 'ENDED', 'stale');
      }
      if (await this.db.kioskScreenWatchSession.findFirst({ where: { targetClientDeviceId, status: { in: liveStatuses } } })) throw busy();
      let session: KioskScreenWatchSession;
      try {
        session = await this.db.kioskScreenWatchSession.create({ data: {
          threadId, viewerEmployeeId: access.employeeId, viewerUserId: access.userId, viewerClientDeviceId: device.id,
          targetClientDeviceId, requestedAt: this.time.now()
        } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw busy();
        throw error;
      }
      this.liveSessions.set(session.id, {
        viewerDeviceId: device.id, viewerName: device.name, targetDeviceId: targetClientDeviceId,
        threadId, status: session.status, control: 'off'
      });
      if (!this.registry.sendToClientDevice(targetClientDeviceId, {
        type: 'watch.request', payload: { watchId: session.id, viewerName: device.name }
      })) {
        await this.transition(session, 'ENDED', 'disconnect');
        throw offline();
      }
      this.timers.set(session.id, this.time.setTimeout(() => {
        void this.expire(session.id).catch(this.reportError);
      }, 60_000));
      return { watchId: session.id };
    });
  }

  async handle(deviceId: string, message: SignalingEnvelope): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(message.payload) ?? '', 'utf8') > 64 * 1024) throw new Error('Watch payload too large');
    // Input never waits for the transition queue or reads the database, including for invalid sessions.
    if (message.type === 'watch.input') {
      const payload = inputSchema.parse(message.payload);
      const live = this.liveSessions.get(payload.watchId);
      if (!live || deviceId !== live.viewerDeviceId) throw new Error('Unauthorized watch input');
      if (live.status !== 'ACTIVE' || live.control !== 'on') throw new Error('Watch control is not active');
      this.registry.sendToClientDevice(live.targetDeviceId, { type: message.type, payload });
      return;
    }
    const { watchId, reason } = payloadSchema.parse(message.payload);
    if (message.type.startsWith('watch.control.')) {
      return this.enqueue(() => this.handleControl(deviceId, message.type, watchId));
    }
    const live = this.liveSessions.get(watchId);
    // The hot path never waits for the transition queue or reads the database.
    if ((message.type === 'watch.signal' || message.type === 'watch.pointer') && live) {
      if (deviceId !== live.viewerDeviceId && deviceId !== live.targetDeviceId) throw new Error('Unauthorized watch participant');
      if (live.status !== 'ACTIVE' && !(live.status === 'REQUESTED' && message.type === 'watch.signal')) {
        throw new Error('Watch session is not active');
      }
      if (message.type === 'watch.pointer') {
        if (deviceId !== live.viewerDeviceId) throw new Error('Only viewer can point');
        point.parse(message.payload);
      }
      const other = deviceId === live.targetDeviceId ? live.viewerDeviceId : live.targetDeviceId;
      this.registry.sendToClientDevice(other, message);
      return;
    }
    // A missing process entry needs a one-off persistent stale-session recovery.
    return this.enqueue(async () => {
      const session = await this.db.kioskScreenWatchSession.findUnique({ where: { id: watchId } });
      if (!session || (deviceId !== session.targetClientDeviceId && deviceId !== session.viewerClientDeviceId)) {
        throw new Error('Unauthorized watch participant');
      }
      const target = deviceId === session.targetClientDeviceId;
      const other = target ? session.viewerClientDeviceId : session.targetClientDeviceId;
      if (liveStatuses.includes(session.status) && !this.liveSessions.has(watchId)) {
        await this.transition(session, 'ENDED', 'stale');
        this.registry.sendToClientDevice(deviceId, { type: 'watch.stopped', payload: { watchId, reason: 'stale' } });
        return;
      }
      if (message.type === 'watch.signal' || message.type === 'watch.pointer') throw new Error('Watch session is not active');
      if (session.status === 'REQUESTED' && this.time.now().getTime() >= session.requestedAt.getTime() + 60_000) {
        await this.timeout(session);
        return;
      }
      if (!liveStatuses.includes(session.status)) throw new Error('Watch session has ended');
      switch (message.type) {
        case 'watch.accept':
        case 'watch.deny': {
          if (!target || session.status !== 'REQUESTED') throw new Error('Invalid watch consent');
          const accepted = message.type === 'watch.accept';
          if (await this.transition(session, accepted ? 'ACTIVE' : 'DENIED', accepted ? undefined : 'denied')) {
            this.registry.sendToClientDevice(other, { type: accepted ? 'watch.accepted' : 'watch.denied', payload: { watchId } });
          }
          return;
        }
        case 'watch.fail':
          if (!target) throw new Error('Only target can report capture failure');
          if (await this.transition(session, 'FAILED', reason ?? 'capture')) {
            this.registry.sendToClientDevice(other, { type: 'watch.stopped', payload: { watchId, reason: reason ?? 'capture' } });
          }
          return;
        case 'watch.stop': {
          const endReason = target ? 'target' : 'viewer';
          if (await this.transition(session, 'ENDED', endReason)) {
            this.registry.sendToClientDevice(other, { type: 'watch.stopped', payload: { watchId, reason: endReason } });
          }
          return;
        }
        default: throw new Error('Invalid watch message type');
      }
    });
  }

  private async handleControl(deviceId: string, type: string, watchId: string): Promise<void> {
    const live = this.liveSessions.get(watchId);
    if (!live || (deviceId !== live.viewerDeviceId && deviceId !== live.targetDeviceId)) {
      throw new Error('Unauthorized watch participant');
    }
    if (live.status !== 'ACTIVE') throw new Error('Watch session is not active');
    const target = deviceId === live.targetDeviceId;
    const other = target ? live.viewerDeviceId : live.targetDeviceId;
    switch (type) {
      case 'watch.control.request':
        if (target || live.control !== 'off') throw new Error('Invalid watch control request');
        if (!this.registry.sendToClientDevice(other, {
          type, payload: { watchId, viewerName: live.viewerName }
        })) throw new Error('Watch target is offline');
        live.control = 'requested';
        return;
      case 'watch.control.accept':
      case 'watch.control.deny': {
        if (!target || live.control !== 'requested') throw new Error('Invalid watch control consent');
        const accepted = type === 'watch.control.accept';
        if (accepted) {
          const now = this.time.now();
          await this.db.$transaction(async tx => {
            await tx.kioskScreenWatchSession.updateMany({
              where: { id: watchId, status: 'ACTIVE', controlGrantedAt: null }, data: { controlGrantedAt: now }
            });
            await recordMessages(tx, live.threadId, now, '操作を始めました');
          });
        }
        live.control = accepted ? 'on' : 'off';
        this.registry.sendToClientDevice(other, {
          type: accepted ? 'watch.control.accepted' : 'watch.control.denied', payload: { watchId }
        });
        return;
      }
      case 'watch.control.stop': {
        if (live.control === 'off') return;
        const wasOperating = live.control === 'on';
        live.control = 'off';
        this.registry.sendToClientDevice(other, { type: 'watch.control.stopped', payload: { watchId } });
        if (wasOperating) await recordMessages(this.db, live.threadId, this.time.now(), '操作を止めました');
        return;
      }
      default: throw new Error('Invalid watch message type');
    }
  }

  private async transition(session: KioskScreenWatchSession, status: KioskScreenWatchStatus, reason?: string): Promise<boolean> {
    const now = this.time.now();
    const changed = await this.db.$transaction(async tx => {
      const updated = await tx.kioskScreenWatchSession.updateMany({
        where: { id: session.id, status: session.status },
        data: { status, ...(status === 'ACTIVE' ? { acceptedAt: now } : { endedAt: now, endReason: reason }) }
      });
      if (!updated.count) return false;
      if (status === 'ACTIVE') {
        await recordMessages(tx, session.threadId, now, '画面を見ています');
      } else if (session.status === 'ACTIVE') {
        const bodies = this.liveSessions.get(session.id)?.control === 'on'
          ? ['操作を止めました', '見るのを止めました'] : ['見るのを止めました'];
        await recordMessages(tx, session.threadId, now, ...bodies);
      }
      return true;
    });
    if (changed) {
      this.clearTimer(session.id);
      const live = this.liveSessions.get(session.id);
      if (status === 'ACTIVE' && live) live.status = status;
      else this.liveSessions.delete(session.id);
    }
    return changed;
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer !== undefined) this.time.clearTimeout(timer);
    this.timers.delete(id);
  }

  private async timeout(session: KioskScreenWatchSession) {
    if (await this.transition(session, 'EXPIRED', 'timeout')) {
      for (const deviceId of [session.viewerClientDeviceId, session.targetClientDeviceId]) {
        this.registry.sendToClientDevice(deviceId, { type: 'watch.stopped', payload: { watchId: session.id, reason: 'timeout' } });
      }
    }
  }

  expire(watchId: string): Promise<void> {
    return this.enqueue(async () => {
      const session = await this.db.kioskScreenWatchSession.findUnique({ where: { id: watchId } });
      if (session?.status === 'REQUESTED') await this.timeout(session);
    });
  }

  private disconnected(deviceId: string): Promise<void> {
    return this.enqueue(async () => {
      const sessions = await this.db.kioskScreenWatchSession.findMany({ where: {
        status: { in: liveStatuses }, OR: [{ viewerClientDeviceId: deviceId }, { targetClientDeviceId: deviceId }]
      } });
      for (const session of sessions) {
        if (await this.transition(session, 'ENDED', 'disconnect')) {
          const other = session.viewerClientDeviceId === deviceId ? session.targetClientDeviceId : session.viewerClientDeviceId;
          this.registry.sendToClientDevice(other, { type: 'watch.stopped', payload: { watchId: session.id, reason: 'disconnect' } });
        }
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.liveSessions.clear();
    for (const id of this.timers.keys()) this.clearTimer(id);
  }
}

export const kioskScreenWatchService = new KioskScreenWatchService(prisma, signalingRegistry);
