import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceUnavailableError, type MultiImageVisionCompletionPort } from '../inference/ports/multi-image-vision-completion.port.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { FfmpegProcedureVideoTranscoderAdapter } from './ffmpeg-procedure-video-transcoder.adapter.js';
import { autoEditLatestOrder, autoEditPrompt, parseAutoEditSuggestion, PROCEDURE_VIDEO_AUTO_EDIT_PROMPT_VERSION } from './procedure-video-auto-edit.js';
import { ProcedureVideoAutoEditJevService } from './procedure-video-auto-edit-jev.service.js';
import type { ProcedureVideoTranscoderPort } from './procedure-video-transcoder.port.js';

export async function enqueueProcedureVideoAutoEdit(videoId: string, db: PrismaClient = prisma) {
  if (!env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED) return null;
  return runAssemblyTransaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${videoId} FOR UPDATE`;
    const video = await tx.procedureVideo.findUnique({ where: { id: videoId } });
    if (!video || video.status !== 'READY' || video.discardedAt || !video.storageKey || !video.durationSeconds || video.durationSeconds > 60) return null;
    const latest = await tx.procedureVideoAutoEditSuggestion.findFirst({ where: { videoId }, orderBy: autoEditLatestOrder });
    // processedAt changes only when encoding publishes READY, including trim/concat.
    if (latest && latest.createdAt >= (video.processedAt ?? video.createdAt)) return null;
    if (await tx.procedureVideoAutoEditSuggestion.findFirst({ where: { videoId, status: { in: ['PENDING', 'RUNNING'] } } })) return null;
    return tx.procedureVideoAutoEditSuggestion.create({ data: { videoId, status: 'PENDING', promptVersion: PROCEDURE_VIDEO_AUTO_EDIT_PROMPT_VERSION } });
  }, db);
}

export async function recoverProcedureVideoAutoEdit(db: PrismaClient = prisma) {
  if (!env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED) return;
  const videos = await db.$queryRaw<Array<{ id: string }>>`
    SELECT v."id" FROM "ProcedureVideo" v
    LEFT JOIN LATERAL (
      SELECT s."createdAt" FROM "ProcedureVideoAutoEditSuggestion" s
      WHERE s."videoId" = v."id" ORDER BY s."createdAt" DESC, s."id" DESC LIMIT 1
    ) latest ON true
    WHERE v."status" = 'READY' AND v."discardedAt" IS NULL AND v."storageKey" IS NOT NULL
      AND v."durationSeconds" > 0 AND v."durationSeconds" <= 60
      AND (latest."createdAt" IS NULL OR latest."createdAt" < COALESCE(v."processedAt", v."createdAt"))
      AND NOT EXISTS (SELECT 1 FROM "ProcedureVideoAutoEditSuggestion" active
        WHERE active."videoId" = v."id" AND active."status" IN ('PENDING', 'RUNNING'))
    ORDER BY COALESCE(v."processedAt", v."createdAt"), v."id" LIMIT 5`;
  for (const video of videos) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueProcedureVideoAutoEdit(video.id, db);
  }
}

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

type Deps = {
  db: PrismaClient;
  store: Pick<DurableFileStorePort, 'copyToFile'>;
  transcoder: ProcedureVideoTranscoderPort;
  vision: MultiImageVisionCompletionPort;
  verifier: Pick<ProcedureVideoAutoEditJevService, 'verify'>;
  localLlmRuntime: Pick<LocalLlmRuntimeControllerPort, 'ensureReady' | 'release'>;
  enabled: () => boolean;
  isVisionConfigured: () => boolean;
  now?: () => Date;
};
class ClaimLostError extends Error {}
class VideoSkippedError extends Error {}

export class ProcedureVideoAutoEditService {
  private running = false;
  constructor(private readonly deps: Deps) {}
  private now() { return this.deps.now?.() ?? new Date(); }

  private async cleanupAbandonedDirectories() {
    try {
      const entries = await readdir(tmpdir(), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^procedure-video-auto-edit-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
        const directory = path.join(tmpdir(), entry.name);
        // Normal jobs are bounded to minutes. A day avoids touching an active job in another process.
        // eslint-disable-next-line no-await-in-loop
        if ((await stat(directory)).mtimeMs < this.now().getTime() - 24 * 60 * 60_000) {
          // eslint-disable-next-line no-await-in-loop
          await rm(directory, { recursive: true, force: true });
        }
      }
    } catch { logger.warn('Procedure video auto edit abandoned temporary cleanup failed'); }
  }

  async runOnce(): Promise<void> {
    if (!this.deps.enabled() || this.running) return;
    this.running = true;
    let directory: string | undefined;
    let runtimeHeld = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatPending: Promise<void> | undefined;
    const ownership = new AbortController();
    try {
      await this.cleanupAbandonedDirectories();
      const processingToken = randomUUID();
      const candidate = await runAssemblyTransaction(async (tx) => {
        // This short claim lock is independent of video encoding. Do not hold a DB transaction during inference.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procedure-video-auto-edit-worker'))`;
        await tx.procedureVideoAutoEditSuggestion.updateMany({
          where: { status: 'RUNNING', updatedAt: { lt: new Date(this.now().getTime() - 10 * 60_000) } },
          data: { status: 'PENDING', processingToken: null },
        });
        if (await tx.procedureVideoAutoEditSuggestion.findFirst({ where: { status: 'RUNNING' } })) return null;
        const row = await tx.procedureVideoAutoEditSuggestion.findFirst({ where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        if (!row) return null;
        const claimed = await tx.procedureVideoAutoEditSuggestion.updateMany({
          where: { id: row.id, status: 'PENDING', updatedAt: row.updatedAt },
          data: { status: 'RUNNING', processingToken },
        });
        return claimed.count ? row : null;
      }, this.deps.db);
      if (!candidate) return;
      const owned = { id: candidate.id, status: 'RUNNING' as const, processingToken };
      const heartbeat = async () => {
        const changed = await this.deps.db.procedureVideoAutoEditSuggestion.updateMany({ where: owned, data: { updatedAt: this.now() } });
        if (!changed.count) throw new ClaimLostError();
      };
      heartbeatTimer = setInterval(() => {
        if (!heartbeatPending) {
          heartbeatPending = heartbeat().catch(() => ownership.abort(new ClaimLostError()))
            .finally(() => { heartbeatPending = undefined; });
        }
      }, 30_000);
      try {
        const video = await this.deps.db.procedureVideo.findUnique({ where: { id: candidate.videoId } });
        const latest = await this.deps.db.procedureVideoAutoEditSuggestion.findFirst({ where: { videoId: candidate.videoId }, orderBy: autoEditLatestOrder });
        if (!video || video.status !== 'READY' || video.discardedAt || !video.storageKey || !video.durationSeconds || video.durationSeconds > 60 || latest?.id !== candidate.id) throw new VideoSkippedError();
        directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-auto-edit-'));
        const input = path.join(directory, 'video.mp4');
        try { await this.deps.store.copyToFile(video.storageKey, input, { verifyIntegrity: true }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new VideoSkippedError();
          throw error;
        }
        const frames = await this.deps.transcoder.extractFrames(input, directory, { intervalSeconds: 1, maxLongEdge: 640 });
        await heartbeat();
        if (!this.deps.isVisionConfigured()) throw new InferenceUnavailableError();
        const readiness = this.deps.localLlmRuntime.ensureReady('photo_label').then(async () => {
          // A readiness request cannot be cancelled; release a late acquisition after ownership loss.
          if (ownership.signal.aborted) await this.deps.localLlmRuntime.release('photo_label');
          else runtimeHeld = true;
        });
        try { await untilAborted(readiness, ownership.signal); }
        catch (error) {
          if (ownership.signal.aborted) throw ownership.signal.reason;
          throw new InferenceUnavailableError();
        }
        const images = await Promise.all(frames.filter((frame) => frame.atSeconds <= video.durationSeconds!).slice(0, 61).map(async (frame) => ({
          imageBytes: await readFile(frame.path), mimeType: 'image/jpeg' as const, label: `${frame.atSeconds}秒`,
        })));
        await heartbeat();
        ownership.signal.throwIfAborted();
        const inferenceController = new AbortController();
        const timeout = setTimeout(() => inferenceController.abort(new Error('Inference timed out')), 120_000);
        const signal = AbortSignal.any([ownership.signal, inferenceController.signal]);
        const response = await untilAborted(this.deps.vision.completeMany({ userText: autoEditPrompt({ ...video, durationSeconds: video.durationSeconds }),
          images, background: true, temperature: 0, timeoutMs: 120_000, signal, maxTokens: 1500, jsonOutput: true }), signal).finally(() => clearTimeout(timeout));
        await heartbeat();
        await this.deps.db.procedureVideoAutoEditSuggestion.updateMany({ where: owned, data: { modelRoute: response.modelRoute, modelName: response.modelName } });
        const suggestion = parseAutoEditSuggestion(response.rawText, video.durationSeconds);
        // Verification is advisory: even a verifier exception must not discard a usable draft.
        const verification = await this.deps.verifier.verify(suggestion, input, directory).catch(() => ({ status: 'unavailable', scenes: [] }));
        await heartbeat();
        await runAssemblyTransaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${video.id} FOR UPDATE`;
          const current = await tx.procedureVideo.findUnique({ where: { id: video.id } });
          const latest = await tx.procedureVideoAutoEditSuggestion.findFirst({ where: { videoId: video.id }, orderBy: autoEditLatestOrder });
          const valid = current?.status === 'READY' && !current.discardedAt && current.storageKey === video.storageKey && latest?.id === candidate.id;
          await tx.procedureVideoAutoEditSuggestion.updateMany({ where: owned, data: valid
            ? { status: 'READY', processingToken: null, suggestion, verification, errorCode: null, errorMessage: null }
            : { status: 'SKIPPED', processingToken: null } });
        }, this.deps.db);
      } catch (error) {
        if (error instanceof ClaimLostError || ownership.signal.aborted) return;
        const skipped = error instanceof VideoSkippedError;
        const unavailable = error instanceof InferenceUnavailableError;
        const attempts = candidate.attempts + (skipped || unavailable ? 0 : 1);
        await this.deps.db.procedureVideoAutoEditSuggestion.updateMany({ where: owned, data: {
          status: skipped ? 'SKIPPED' : attempts > 3 ? 'FAILED' : 'PENDING', attempts, processingToken: null,
          errorCode: skipped ? 'VIDEO_UNAVAILABLE' : unavailable ? 'MODEL_UNAVAILABLE' : 'AUTO_EDIT_FAILED',
          errorMessage: skipped ? '動画が利用できないか、最新の提案ではありません' : unavailable ? '業務モデルの再開を待っています' : '自動編集案を作成できませんでした',
        } });
      }
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatPending;
      try {
        if (runtimeHeld) await this.deps.localLlmRuntime.release('photo_label').catch(() => undefined);
      } finally {
        try { if (directory) await rm(directory, { recursive: true, force: true }); }
        finally { this.running = false; }
      }
    }
  }
}

let service: ProcedureVideoAutoEditService | undefined;
export function getProcedureVideoAutoEditService() {
  if (!service) {
    const runtime = getInferenceRuntime();
    const transcoder = new FfmpegProcedureVideoTranscoderAdapter();
    service = new ProcedureVideoAutoEditService({ db: prisma, store: getFileStorageRuntime().store, transcoder,
      vision: runtime.createMultiImageVisionCompletionPort(), localLlmRuntime: getLocalLlmRuntimeController(),
      verifier: new ProcedureVideoAutoEditJevService({ enabled: () => env.PROCEDURE_VIDEO_AUTO_EDIT_JEV_ENABLED, apiKey: () => env.TYPESAFE_API_KEY, transcoder }),
      enabled: () => env.PROCEDURE_VIDEO_AUTO_EDIT_ENABLED, isVisionConfigured: () => runtime.isPhotoLabelInferenceConfigured() });
  }
  return service;
}
