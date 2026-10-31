import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';

const uuid = z.string().uuid('IDの形式が正しくありません');
export const sampleIdSchema = z.object({ id: uuid });
export const sampleFrameIdSchema = z.object({ frameId: uuid });
export const sampleImageSchema = sampleFrameIdSchema.extend({ variant: z.enum(['full', 'thumb'], { error: '画像の種類が正しくありません' }) });
export const sampleStartSchema = z.object({
  clientDeviceId: uuid,
  intervalSec: z.union([z.literal(10), z.literal(30), z.literal(60), z.literal(300)], { error: '間隔を選んでください' }),
  durationSec: z.union([z.literal(300), z.literal(3600), z.literal(86400), z.literal(604800)], { error: '期間を選んでください' }),
  maxFrames: z.number({ error: '上限枚数を入力してください' }).int('上限枚数は整数です').min(10, '上限枚数は10枚以上です').max(20000, '上限枚数は20000枚以下です'),
});
export const sampleListSchema = z.object({ clientDeviceId: uuid.optional() });
export const sampleFramesSchema = z.object({
  label: z.enum(['all', 'none', 'ok', 'ng', 'later'], { error: '絞り込みが正しくありません' }).default('all'),
  limit: z.coerce.number({ error: '件数は整数で指定してください' }).int('件数は整数です').min(1, '件数は1以上です').max(200, '件数は200以下です').default(60),
});
export const sampleLabelSchema = z.object({ label: z.enum(['ok', 'ng', 'later'], { error: '印を選んでください' }).nullable() });

// Serialize mutations, including the shared capacity check and deletion, within this API process.
let pending: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.catch(() => undefined);
  return result;
}
const receiving = new Set<string>();

async function expireSessions(clientDeviceId?: string) {
  const now = new Date();
  await prisma.watchCameraSampleSession.updateMany({
    where: { clientDeviceId, status: 'running', endsAt: { lte: now } },
    data: { status: 'completed', endedAt: now },
  });
}

export function listSampleCameras() {
  return prisma.clientDevice.findMany({ where: { name: { startsWith: 'zero-edge-cam-' } },
    select: { id: true, name: true, location: true }, orderBy: { name: 'asc' } });
}

export function startSampleSession(input: z.infer<typeof sampleStartSchema>) {
  return exclusive(async () => {
    const camera = await prisma.clientDevice.findUnique({ where: { id: input.clientDeviceId }, select: { name: true } });
    if (!camera?.name.startsWith('zero-edge-cam-')) throw new ApiError(400, '監視カメラ端末を選んでください');
    await expireSessions(input.clientDeviceId);
    if (await prisma.watchCameraSampleSession.findFirst({ where: { clientDeviceId: input.clientDeviceId, status: 'running' } })) {
      throw new ApiError(409, 'このカメラは撮影中です');
    }
    const now = new Date();
    try {
      return await prisma.watchCameraSampleSession.create({ data: { ...input, status: 'running', startedAt: now,
        endsAt: new Date(now.getTime() + input.durationSec * 1000) } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(409, 'このカメラは撮影中です');
      throw error;
    }
  });
}

export async function receiveSampleFrame(deviceId: string, bytes: Buffer): Promise<void> {
  if (receiving.has(deviceId)) return;
  receiving.add(deviceId);
  try {
    await exclusive(async () => {
      const session = await prisma.watchCameraSampleSession.findFirst({ where: { clientDeviceId: deviceId, status: 'running' } });
      if (!session) return;
      const now = new Date();
      if (now >= session.endsAt || session.frameCount >= session.maxFrames) {
        await prisma.watchCameraSampleSession.update({ where: { id: session.id }, data: { status: 'completed', endedAt: now } });
        return;
      }
      if (session.lastCapturedAt && now.getTime() - session.lastCapturedAt.getTime() < (session.intervalSec - 2) * 1000) return;
      const total = (await prisma.watchCameraSampleSession.aggregate({ _sum: { byteSize: true } }))._sum.byteSize ?? 0;
      // Each session uses a Prisma Int; stop before its signed 32-bit limit as well.
      if (total + bytes.length > env.WATCH_CAMERA_SAMPLE_MAX_BYTES || session.byteSize + bytes.length > 2147483647) {
        await prisma.watchCameraSampleSession.update({ where: { id: session.id }, data: { status: 'completed', endedAt: now } });
        return;
      }
      const id = randomUUID();
      const fileKey = `photos/watch-camera-samples/${session.id}/${id}.jpg`;
      const store = getFileStorageRuntime().store;
      await store.writeBatch([{ key: fileKey, data: bytes, mode: 'create', integrity: true }]);
      try {
        const completed = session.frameCount + 1 >= session.maxFrames;
        await prisma.watchCameraSampleSession.update({ where: { id: session.id }, data: {
          frames: { create: { id, capturedAt: now, fileKey, byteSize: bytes.length } },
          frameCount: { increment: 1 }, byteSize: { increment: bytes.length }, lastCapturedAt: now,
          ...(completed ? { status: 'completed', endedAt: now } : {}),
        } });
      } catch (error) {
        await Promise.allSettled([store.delete(fileKey, { integrity: true })]);
        throw error;
      }
    });
  } finally { receiving.delete(deviceId); }
}

export function stopSampleSession(id: string) {
  return exclusive(async () => {
    await expireSessions();
    const session = await prisma.watchCameraSampleSession.findUnique({ where: { id } });
    if (!session) throw new ApiError(404, '見本がありません');
    if (session.status !== 'running') return session;
    return prisma.watchCameraSampleSession.update({ where: { id }, data: { status: 'stopped', endedAt: new Date() } });
  });
}

export function listSampleSessions(clientDeviceId?: string) {
  return exclusive(async () => {
    await expireSessions(clientDeviceId);
    const rows = await prisma.watchCameraSampleSession.findMany({ where: { clientDeviceId }, orderBy: { startedAt: 'desc' }, take: 20,
      select: { id: true, clientDevice: { select: { name: true } }, intervalSec: true, durationSec: true, maxFrames: true,
        status: true, startedAt: true, endsAt: true, endedAt: true, frameCount: true, byteSize: true } });
    const groups = await prisma.watchCameraSampleFrame.groupBy({ by: ['sessionId', 'label'],
      where: { sessionId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
    return rows.map(({ clientDevice, ...row }) => {
      const counts = { ok: 0, ng: 0, later: 0, none: 0 };
      for (const group of groups) if (group.sessionId === row.id) counts[group.label ?? 'none'] = group._count._all;
      return { ...row, deviceName: clientDevice.name, counts };
    });
  });
}

export function listSampleFrames(sessionId: string, query: z.infer<typeof sampleFramesSchema>) {
  return prisma.watchCameraSampleFrame.findMany({ where: { sessionId,
    ...(query.label === 'all' ? {} : { label: query.label === 'none' ? null : query.label }) },
  select: { id: true, capturedAt: true, label: true }, orderBy: { capturedAt: 'desc' }, take: query.limit });
}

export async function labelSampleFrame(frameId: string, label: z.infer<typeof sampleLabelSchema>['label']) {
  const result = await prisma.watchCameraSampleFrame.updateMany({ where: { id: frameId }, data: { label } });
  if (!result.count) throw new ApiError(404, '写真がありません');
}

export async function readSampleFrame(frameId: string, variant: 'full' | 'thumb') {
  const row = await prisma.watchCameraSampleFrame.findUnique({ where: { id: frameId }, select: { fileKey: true } });
  if (!row) throw new ApiError(404, '写真がありません');
  let bytes: Buffer;
  try { bytes = await getFileStorageRuntime().store.read(row.fileKey, { verifyIntegrity: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new ApiError(404, '写真がありません');
    throw error;
  }
  return variant === 'thumb' ? sharp(bytes).resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer() : bytes;
}

export function deleteSampleSession(id: string) {
  return exclusive(async () => {
    const session = await prisma.watchCameraSampleSession.findUnique({ where: { id } });
    if (!session) throw new ApiError(404, '見本がありません');
    if (session.status === 'running') {
      await prisma.watchCameraSampleSession.update({ where: { id }, data: { status: 'stopped', endedAt: new Date() } });
    }
    const frames = await prisma.watchCameraSampleFrame.findMany({ where: { sessionId: id }, select: { fileKey: true } });
    for (const frame of frames) {
      try { await getFileStorageRuntime().store.delete(frame.fileKey, { integrity: true }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw new ApiError(500, '写真を削除できませんでした');
      }
    }
    await prisma.watchCameraSampleSession.delete({ where: { id } });
  });
}
