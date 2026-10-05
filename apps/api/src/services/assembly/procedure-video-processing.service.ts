import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { FfmpegProcedureVideoTranscoderAdapter } from './ffmpeg-procedure-video-transcoder.adapter.js';
import { ProcedureVideoTranscodeError, type ProcedureVideoTranscoderPort } from './procedure-video-transcoder.port.js';

export class ProcedureVideoProcessingService {
  private running = false;
  constructor(
    private readonly transcoder: ProcedureVideoTranscoderPort = new FfmpegProcedureVideoTranscoderAdapter(),
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
  ) {}

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.procedureVideo.updateMany({
        where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        data: { status: 'PENDING' },
      });
      const originals = await this.db.procedureVideo.findMany({
        where: { status: 'READY', sourceStorageKey: { not: null } },
        select: { id: true, sourceStorageKey: true },
      });
      for (const video of originals) {
        if (video.sourceStorageKey) await this.cleanupOriginal(video.id, video.sourceStorageKey);
      }
      const candidate = await this.db.procedureVideo.findFirst({ where: { status: 'PENDING', discardedAt: null }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
      if (!candidate) return;
      const claim = await this.db.procedureVideo.updateMany({ where: { id: candidate.id, status: 'PENDING', updatedAt: candidate.updatedAt, discardedAt: null }, data: { status: 'PROCESSING' } });
      if (!claim.count) return;
      const video = await this.db.procedureVideo.findUnique({ where: { id: candidate.id } });
      if (!video) return;
      const trim = video.trimRequest as { startSeconds: number; endSeconds: number } | null;
      const isTrim = Boolean(trim && video.storageKey);
      let directory: string | undefined;
      try {
        const inputKey = isTrim ? video.storageKey : video.sourceStorageKey;
        if (!inputKey) throw new ProcedureVideoTranscodeError('SOURCE_MISSING', '動画の原本がありません');
        directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-'));
        const input = path.join(directory, 'original');
        const output = path.join(directory, 'video.mp4');
        const poster = path.join(directory, 'poster.jpg');
        await writeFile(input, await this.store.read(inputKey, { verifyIntegrity: true }));
        const probe = await this.transcoder.probe(input);
        if (!isTrim && probe.durationSeconds > 60) throw new ProcedureVideoTranscodeError('TOO_LONG', '動画は60秒までです');
        if (isTrim && trim) await this.transcoder.trim(input, output, poster, trim.startSeconds, trim.endSeconds);
        else await this.transcoder.transcode(input, output, poster);
        const converted = await this.transcoder.probe(output);
        const bytes = await readFile(output);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const storageKey = `procedure-videos/${sha256}/video.mp4`;
        const posterStorageKey = `procedure-videos/${sha256}/poster.jpg`;
        const posterBytes = await readFile(poster);
        await runAssemblyTransaction(async (tx) => {
          // Writers and old-output cleanup share the same lock. Keep encoding outside it.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${storageKey}))`;
          await this.save(storageKey, bytes);
          await this.save(posterStorageKey, posterBytes);
          if (isTrim && trim) {
            const comments = await tx.procedureVideoComment.findMany({ where: { videoId: video.id }, orderBy: { sortOrder: 'asc' } });
            await tx.procedureVideoComment.deleteMany({ where: { videoId: video.id } });
            const retained = comments.filter((comment) => comment.atSeconds >= trim.startSeconds && comment.atSeconds <= trim.endSeconds);
            if (retained.length) await tx.procedureVideoComment.createMany({ data: retained.map((comment, sortOrder) => ({ id: comment.id, videoId: video.id, text: comment.text, createdAt: comment.createdAt, atSeconds: comment.atSeconds - trim.startSeconds, sortOrder })) });
          }
          await tx.procedureVideo.update({ where: { id: video.id }, data: {
            status: 'READY', storageKey, posterStorageKey, sha256, byteSize: bytes.length, ...converted,
            errorCode: null, errorMessage: null, processedAt: new Date(),
            ...(isTrim ? { trimmedAt: new Date(), trimRequest: Prisma.DbNull } : { sourceDurationSeconds: probe.durationSeconds }),
          } });
        }, this.db);
        if (isTrim && video.storageKey && video.storageKey !== storageKey) await this.cleanupOutput(video.id, video.storageKey, video.posterStorageKey);
        if (video.sourceStorageKey) await this.cleanupOriginal(video.id, video.sourceStorageKey);
      } catch (error) {
        const code = error instanceof ProcedureVideoTranscodeError ? error.code : 'PROCESSING_FAILED';
        const attempts = video.attempts + 1;
        const terminal = ['TOO_LONG', 'FFMPEG_UNAVAILABLE', 'SOURCE_MISSING'].includes(code) || attempts > 3;
        await this.db.procedureVideo.update({ where: { id: video.id }, data: { status: terminal ? (isTrim ? 'READY' : 'FAILED') : 'PENDING', attempts, errorCode: isTrim ? 'TRIM_FAILED' : code, errorMessage: error instanceof Error ? error.message.slice(0, 500) : '動画処理に失敗しました', ...(isTrim && terminal ? { trimRequest: Prisma.DbNull } : {}) } });
        if (code === 'FFMPEG_UNAVAILABLE') logger.warn({ videoId: video.id, code }, 'Procedure video transcoder unavailable');
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    } finally { this.running = false; }
  }

  private async cleanupOriginal(videoId: string, sourceStorageKey: string): Promise<void> {
    try {
      const deleteOriginal = await runAssemblyTransaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceStorageKey}))`;
        const video = await tx.procedureVideo.findUnique({ where: { id: videoId }, select: { status: true, sourceStorageKey: true } });
        if (video?.status !== 'READY' || video.sourceStorageKey !== sourceStorageKey) return false;
        const references = await tx.procedureVideo.count({ where: { sourceStorageKey } });
        await tx.procedureVideo.update({ where: { id: videoId }, data: { sourceStorageKey: null } });
        return references === 1;
      }, this.db);
      // Both READY and the cleared reference are committed before file deletion.
      if (deleteOriginal) await this.store.delete(sourceStorageKey, { integrity: true });
    } catch (error) {
      logger.warn({ videoId, err: error }, 'Procedure video original cleanup failed');
    }
  }

  private async cleanupOutput(videoId: string, storageKey: string, posterStorageKey: string | null): Promise<void> {
    try {
      // READY is already committed. Hold the lock through deletion so another
      // conversion cannot publish this hash between the reference check and delete.
      await runAssemblyTransaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${storageKey}))`;
        if (await tx.procedureVideo.count({ where: { storageKey } })) return;
        await this.store.delete(storageKey, { integrity: true });
        if (posterStorageKey) await this.store.delete(posterStorageKey, { integrity: true });
      }, this.db);
    } catch (error) {
      logger.warn({ videoId, err: error }, 'Procedure video old output cleanup failed');
    }
  }

  private async save(key: string, data: Buffer) {
    try { await this.store.write({ key, data, mode: 'create', integrity: true }); }
    catch (error) {
      if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
      if (!(await this.store.read(key, { verifyIntegrity: true })).equals(data)) throw new Error('Procedure video identity conflict');
    }
  }
}

let service: ProcedureVideoProcessingService | undefined;
export function getProcedureVideoProcessingService() { return service ??= new ProcedureVideoProcessingService(); }
