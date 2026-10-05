import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
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

class ProcedureVideoClaimLostError extends Error {}

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
      const processingToken = randomUUID();
      const claim = await this.db.procedureVideo.updateMany({ where: { id: candidate.id, status: 'PENDING', updatedAt: candidate.updatedAt, discardedAt: null }, data: { status: 'PROCESSING', processingToken } });
      if (!claim.count) return;
      const video = await this.db.procedureVideo.findUnique({ where: { id: candidate.id } });
      if (!video || video.status !== 'PROCESSING' || video.processingToken !== processingToken) return;
      const processingWhere = { id: video.id, status: 'PROCESSING' as const, processingToken };
      const heartbeat = async () => {
        const result = await this.db.procedureVideo.updateMany({ where: processingWhere, data: { updatedAt: new Date() } });
        if (!result.count) throw new ProcedureVideoClaimLostError();
      };
      const trim = video.trimRequest as { startSeconds: number; endSeconds: number } | null;
      const concat = video.concatRequest as { sourceVideoIds: string[]; requestedAt: string } | null;
      const isTrim = Boolean(trim && video.storageKey);
      let directory: string | undefined;
      try {
        directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-'));
        const input = path.join(directory, 'original');
        const output = path.join(directory, 'video.mp4');
        const poster = path.join(directory, 'poster.jpg');
        let sourceDurationSeconds: number;
        const concatSources: Array<{ id: string; storageKey: string; durationSeconds: number }> = [];
        if (concat) {
          const sources = await this.db.procedureVideo.findMany({ where: { id: { in: concat.sourceVideoIds } } });
          const inputs: string[] = [];
          for (const [index, id] of concat.sourceVideoIds.entries()) {
            const source = sources.find((row) => row.id === id);
            if (!source || source.status !== 'READY' || source.discardedAt || !source.storageKey) throw new ProcedureVideoTranscodeError('SOURCE_MISSING', '接続元の動画がないか、完了していないか、捨てられています');
            const sourceInput = path.join(directory, `${index}.mp4`);
            // eslint-disable-next-line no-await-in-loop
            await writeFile(sourceInput, await this.store.read(source.storageKey, { verifyIntegrity: true }));
            // eslint-disable-next-line no-await-in-loop
            const probe = await this.transcoder.probe(sourceInput);
            concatSources.push({ id, storageKey: source.storageKey, durationSeconds: probe.durationSeconds });
            inputs.push(sourceInput);
          }
          await this.transcoder.concat(inputs, output, poster, heartbeat);
          sourceDurationSeconds = concatSources.reduce((sum, source) => sum + source.durationSeconds, 0);
        } else {
          const inputKey = isTrim ? video.storageKey : video.sourceStorageKey;
          if (!inputKey) throw new ProcedureVideoTranscodeError('SOURCE_MISSING', '動画の原本がありません');
          await writeFile(input, await this.store.read(inputKey, { verifyIntegrity: true }));
          const probe = await this.transcoder.probe(input);
          sourceDurationSeconds = probe.durationSeconds;
          if (!isTrim && probe.durationSeconds > 60) throw new ProcedureVideoTranscodeError('TOO_LONG', '動画は60秒までです');
          if (isTrim && trim) await this.transcoder.trim(input, output, poster, trim.startSeconds, trim.endSeconds, heartbeat);
          else await this.transcoder.transcode(input, output, poster, heartbeat);
        }
        const { durationSeconds, width, height } = await this.transcoder.probe(output);
        const bytes = await readFile(output);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const storageKey = `procedure-videos/${sha256}/video.mp4`;
        const posterStorageKey = `procedure-videos/${sha256}/poster.jpg`;
        const posterBytes = await readFile(poster);
        const published = await runAssemblyTransaction(async (tx) => {
          const result = await tx.procedureVideo.updateMany({ where: processingWhere, data: {
            status: 'READY', storageKey, posterStorageKey, sha256, byteSize: bytes.length, durationSeconds, width, height,
            errorCode: null, errorMessage: null, processedAt: new Date(),
            ...(isTrim ? { trimmedAt: new Date(), trimRequest: Prisma.DbNull } : { sourceDurationSeconds }),
            ...(concat ? { concatRequest: Prisma.DbNull } : {}),
          } });
          if (!result.count) {
            logger.info({ videoId: video.id }, 'Procedure video claim was recovered before READY');
            return false;
          }
          if (concat) {
            for (const id of [...new Set(concat.sourceVideoIds)].sort()) {
              // eslint-disable-next-line no-await-in-loop
              await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
            }
            const current = await tx.procedureVideo.findMany({ where: { id: { in: concat.sourceVideoIds } }, include: { comments: { orderBy: [{ atSeconds: 'asc' }, { sortOrder: 'asc' }] } } });
            let offset = 0;
            const comments: Array<{ videoId: string; atSeconds: number; text: string; sortOrder: number }> = [];
            for (const source of concatSources) {
              const row = current.find((item) => item.id === source.id);
              if (!row || row.status !== 'READY' || row.discardedAt || row.storageKey !== source.storageKey) throw new ProcedureVideoTranscodeError('SOURCE_MISSING', '処理中に接続元の動画が変更・削除・破棄されました');
              for (const comment of row.comments) {
                if (comments.length < 5) comments.push({ videoId: video.id, atSeconds: offset + comment.atSeconds, text: comment.text, sortOrder: comments.length });
              }
              offset += source.durationSeconds;
            }
            // A recovered/retried request publishes comments and READY atomically.
            await tx.procedureVideoComment.deleteMany({ where: { videoId: video.id } });
            if (comments.length) await tx.procedureVideoComment.createMany({ data: comments });
          }
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
          return true;
        }, this.db);
        if (!published) return;
        if (isTrim && video.storageKey && video.storageKey !== storageKey) await this.cleanupOutput(video.id, video.storageKey, video.posterStorageKey);
        if (video.sourceStorageKey) await this.cleanupOriginal(video.id, video.sourceStorageKey);
      } catch (error) {
        if (error instanceof ProcedureVideoClaimLostError) {
          logger.info({ videoId: video.id }, 'Procedure video claim was recovered during encoding');
          return;
        }
        const code = error instanceof ProcedureVideoTranscodeError ? error.code : 'PROCESSING_FAILED';
        const attempts = video.attempts + 1;
        const terminal = ['TOO_LONG', 'FFMPEG_UNAVAILABLE', 'SOURCE_MISSING'].includes(code) || attempts > 3;
        const result = await this.db.procedureVideo.updateMany({ where: processingWhere, data: { status: terminal ? (isTrim ? 'READY' : 'FAILED') : 'PENDING', attempts, errorCode: concat ? 'CONCAT_FAILED' : isTrim ? 'TRIM_FAILED' : code, errorMessage: error instanceof Error ? error.message.slice(0, 500) : '動画処理に失敗しました', ...(isTrim && terminal ? { trimRequest: Prisma.DbNull } : {}) } });
        if (!result.count) logger.info({ videoId: video.id }, 'Procedure video claim was recovered before failure update');
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
