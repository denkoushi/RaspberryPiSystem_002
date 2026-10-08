import { AssemblyProcedureDocumentEditLeaseService, type AssemblyProcedureEditActor } from './assembly-procedure-document-edit-lease.service.js';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from '../../lib/logger.js';
import { FfmpegProcedureVideoTranscoderAdapter } from './ffmpeg-procedure-video-transcoder.adapter.js';
import type { ProcedureVideoTranscoderPort } from './procedure-video-transcoder.port.js';
import { ApiError } from '../../lib/errors.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import type { ProcedureMaterialVideo } from './procedure-material-gmail-packet-resolver.js';
import { runAssemblyTransaction } from './assembly-transaction.js';
import { AssemblyTemplateAccessService } from './assembly-template-access.service.js';

export const procedureVideoLinksInclude = {
  orderBy: [{ pageIndex: 'asc' as const }, { sortOrder: 'asc' as const }],
  include: { video: true, scene: true }
};
export type ProcedureVideoSummary = { id: string; title: string; durationSeconds: number | null; status: string; sceneId: string | null; startSeconds: number | null; endSeconds: number | null; hasScenePoster: boolean };
export type ProcedureVideoPageLink = {
  pageIndex: number; sceneId?: string | null;
  video: Pick<ProcedureVideoSummary, 'id' | 'title' | 'durationSeconds' | 'status'> & { discardedAt?: Date | null };
  scene?: { title: string; startSeconds: number; endSeconds: number; posterStorageKey?: string | null } | null;
};
function videoSummary({ video, sceneId, scene }: ProcedureVideoPageLink): ProcedureVideoSummary {
  return { id: video.id, title: scene?.title ?? video.title, status: video.status, sceneId: sceneId ?? null,
    durationSeconds: scene ? Math.round((scene.endSeconds - scene.startSeconds) * 10) / 10 : video.durationSeconds,
    startSeconds: scene?.startSeconds ?? null, endSeconds: scene?.endSeconds ?? null, hasScenePoster: Boolean(sceneId && scene?.posterStorageKey) };
}
export function videosForPage(links: ProcedureVideoPageLink[] | undefined, pageIndex: number): ProcedureVideoSummary[] {
  return (links ?? []).filter((link) => link.pageIndex === pageIndex && link.video.status === 'READY' && !link.video.discardedAt).map(videoSummary);
}
const roundSceneTime = (value: number) => Math.round(value * 10) / 10;
function sceneRange(duration: number | null, start: number, end: number) {
  const startSeconds = roundSceneTime(start), endSeconds = roundSceneTime(end);
  if (duration == null || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || startSeconds < 0 || endSeconds > duration || Math.round((endSeconds - startSeconds) * 10) < 5) {
    throw new ApiError(400, '開始・終了は動画の範囲内で、長さは0.5秒以上にしてください');
  }
  return { startSeconds, endSeconds };
}
function sceneTitle(title: string | undefined) {
  if (title != null && title.trim().length > 80) throw new ApiError(400, '場面名は80文字以内にしてください');
  return title?.trim();
}

export class ProcedureVideoService {
  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly access = new AssemblyTemplateAccessService(),
    private readonly transcoder: ProcedureVideoTranscoderPort = new FfmpegProcedureVideoTranscoderAdapter(),
  ) {}

  async ingest(video: ProcedureMaterialVideo, common: { gmailMessageId: string; fromEmail: string | null; subjectHint: string | null; receivedAt: Date }): Promise<boolean> {
    const sourceStorageKey = `procedure-videos/incoming/${video.sha256}/original`;
    try {
      return await runAssemblyTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceStorageKey}))`;
        if (await tx.procedureVideo.findUnique({ where: { gmailDedupeKey: video.gmailDedupeKey } })) return false;
        try { await this.store.write({ key: sourceStorageKey, data: video.buffer, mode: 'create', integrity: true }); }
        catch (error) {
          if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
          if (!(await this.store.read(sourceStorageKey, { verifyIntegrity: true })).equals(video.buffer)) throw new Error('Procedure video identity conflict');
        }
        await tx.procedureVideo.create({ data: { ...common, origin: 'GMAIL', status: 'PENDING', title: common.subjectHint || video.filename, gmailDedupeKey: video.gmailDedupeKey, sourceStorageKey, sourceFileName: video.filename, sourceContentType: video.contentType, sourceByteSize: video.buffer.length } });
        return true;
      }, this.db);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      if (!await this.db.procedureVideo.findUnique({ where: { gmailDedupeKey: video.gmailDedupeKey } })) throw error;
      return false;
    }
  }

  async list(params: { state: 'active' | 'discarded' | 'all'; q?: string; limit: number }) {
    const rows = await this.db.procedureVideo.findMany({
      where: { ...(params.state === 'active' ? { discardedAt: null } : params.state === 'discarded' ? { discardedAt: { not: null } } : {}), ...(params.q ? { OR: [{ title: { contains: params.q, mode: 'insensitive' as const } }, { subjectHint: { contains: params.q, mode: 'insensitive' as const } }] } : {}) },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: params.limit, include: { _count: { select: { links: true, scenes: true } } }
    });
    return rows.map((row) => ({ id: row.id, title: row.title, origin: row.origin ?? 'GMAIL', status: row.status, durationSeconds: row.durationSeconds, hasPoster: Boolean(row.posterStorageKey), linkCount: row._count.links, sceneCount: row._count.scenes, errorCode: row.errorCode, errorMessage: row.errorMessage, discardedAt: row.discardedAt?.toISOString() ?? null }));
  }

  async requestConcat(sourceVideoIds: string[], title?: string) {
    if (sourceVideoIds.length < 2 || sourceVideoIds.length > 5) throw new ApiError(400, '動画は2〜5本選んでください');
    return runAssemblyTransaction(async (tx) => {
      for (const id of [...new Set(sourceVideoIds)].sort()) {
        // eslint-disable-next-line no-await-in-loop
        await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      }
      const sources = await tx.procedureVideo.findMany({ where: { id: { in: sourceVideoIds } } });
      const ordered = sourceVideoIds.map((id) => sources.find((source) => source.id === id));
      if (ordered.some((source) => !source || source.status !== 'READY' || source.discardedAt)) throw new ApiError(409, '完了した動画だけ接続できます');
      const receivedAt = new Date();
      return tx.procedureVideo.create({ data: {
        status: 'PENDING', origin: 'CONCAT', title: title?.trim() || `${ordered[0]!.title} ほか ${sourceVideoIds.length - 1} 本`,
        gmailDedupeKey: `concat:${randomUUID()}`, gmailMessageId: null, receivedAt,
        sourceFileName: 'concat.mp4', sourceContentType: 'video/mp4', sourceByteSize: 0,
        concatRequest: { sourceVideoIds, requestedAt: receivedAt.toISOString() },
      } });
    }, this.db);
  }

  async readFile(id: string, poster = false) {
    const video = await this.db.procedureVideo.findUnique({ where: { id } });
    const key = poster ? video?.posterStorageKey : video?.storageKey;
    if (video?.status !== 'READY' || !key) throw new ApiError(404, '動画がありません');
    return this.store.read(key, { verifyIntegrity: true });
  }

  async retry(id: string) {
    const changed = await this.db.procedureVideo.updateMany({ where: { id, status: 'FAILED', OR: [{ sourceStorageKey: { not: null } }, { concatRequest: { not: Prisma.DbNull } }] }, data: { status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    if (!changed.count) throw new ApiError(409, '原本のある失敗動画だけ再試行できます');
  }

  async requestTrim(id: string, startSeconds: number, endSeconds: number) {
    await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      if (video.status !== 'READY') throw new ApiError(409, '完了した動画だけトリミングできます');
      if (video.durationSeconds == null || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds > video.durationSeconds || endSeconds < startSeconds + 0.5) {
        throw new ApiError(400, '開始・終了は動画の範囲内で、長さは0.5秒以上にしてください');
      }
      if (await tx.procedureVideoScene.count({ where: { videoId: id } })) throw new ApiError(409, '場面のある動画はトリミングできません');
      if (await tx.procedureVideoLink.count({ where: { videoId: id } })) throw new ApiError(409, '紐づけを外してからトリミングしてください');
      await tx.procedureVideo.update({ where: { id }, data: { trimRequest: { startSeconds, endSeconds, requestedAt: new Date().toISOString() }, status: 'PENDING', attempts: 0, errorCode: null, errorMessage: null } });
    }, this.db);
  }

  async listScenes(id: string) {
    if (!await this.db.procedureVideo.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, '動画がありません');
    const scenes = await this.db.procedureVideoScene.findMany({ where: { videoId: id }, orderBy: [{ startSeconds: 'asc' }, { id: 'asc' }], include: { _count: { select: { links: true } } } });
    return scenes.map(({ id, title, startSeconds, endSeconds, posterStorageKey, _count }) => ({ id, title, startSeconds, endSeconds, linkCount: _count.links, hasScenePoster: Boolean(posterStorageKey) }));
  }

  async createScene(id: string, input: { title?: string; startSeconds: number; endSeconds: number }) {
    const result = await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      if (video.status !== 'READY' || video.discardedAt || video.trimRequest) throw new ApiError(409, '完了した動画だけ場面を追加できます');
      const range = sceneRange(video.durationSeconds, input.startSeconds, input.endSeconds);
      const count = await tx.procedureVideoScene.count({ where: { videoId: id } });
      if (count >= 20) throw new ApiError(400, '場面は20件までです');
      const scene = await tx.procedureVideoScene.create({ data: { videoId: id, title: sceneTitle(input.title) || `場面 ${count + 1}`, ...range } });
      return { scene, storageKey: video.storageKey };
    }, this.db);
    const hasScenePoster = await this.generateScenePoster(id, result.scene.id, result.scene.startSeconds, result.storageKey);
    return { id: result.scene.id, title: result.scene.title, startSeconds: result.scene.startSeconds, endSeconds: result.scene.endSeconds, linkCount: 0, hasScenePoster };
  }

  async updateScene(id: string, sceneId: string, input: { title?: string; startSeconds?: number; endSeconds?: number }) {
    const result = await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      const scene = await tx.procedureVideoScene.findFirst({ where: { id: sceneId, videoId: id } });
      if (!scene) throw new ApiError(404, '場面がありません');
      const linkCount = await tx.procedureVideoLink.count({ where: { sceneId } });
      const range = input.startSeconds == null && input.endSeconds == null ? {} : sceneRange(video.durationSeconds, input.startSeconds ?? scene.startSeconds, input.endSeconds ?? scene.endSeconds);
      const rangeChanged = ('startSeconds' in range && range.startSeconds !== scene.startSeconds) || ('endSeconds' in range && range.endSeconds !== scene.endSeconds);
      if (rangeChanged) {
        if (linkCount) throw new ApiError(409, 'ページに紐づいている場面の範囲は変えられません');
        if (video.status !== 'READY' || video.discardedAt || video.trimRequest) throw new ApiError(409, '完了した動画だけ場面の範囲を変えられます');
      }
      const updated = await tx.procedureVideoScene.update({ where: { id: sceneId }, data: { ...range, ...(rangeChanged ? { posterStorageKey: null } : {}), ...(input.title == null ? {} : { title: sceneTitle(input.title) || scene.title }) } });
      return { updated, linkCount, rangeChanged, previousPoster: scene.posterStorageKey, storageKey: video.storageKey };
    }, this.db);
    const { updated, linkCount, rangeChanged } = result;
    if (rangeChanged) await this.cleanupScenePoster(sceneId, result.previousPoster);
    const hasScenePoster = rangeChanged ? await this.generateScenePoster(id, sceneId, updated.startSeconds, result.storageKey) : Boolean(updated.posterStorageKey);
    return { id: updated.id, title: updated.title, startSeconds: updated.startSeconds, endSeconds: updated.endSeconds, linkCount, hasScenePoster };
  }

  async deleteScene(id: string, sceneId: string) {
    const posterStorageKey = await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const scene = await tx.procedureVideoScene.findFirst({ where: { id: sceneId, videoId: id } });
      if (!scene) throw new ApiError(404, '場面がありません');
      if (await tx.procedureVideoLink.count({ where: { sceneId } })) throw new ApiError(409, 'ページに紐づいている場面は削除できません');
      await tx.procedureVideoScene.delete({ where: { id: sceneId } });
      return scene.posterStorageKey;
    }, this.db);
    await this.cleanupScenePoster(sceneId, posterStorageKey);
  }

  async readScenePoster(id: string, sceneId: string) {
    const scene = await this.db.procedureVideoScene.findFirst({ where: { id: sceneId, videoId: id, video: { status: 'READY' } } });
    if (!scene?.posterStorageKey) throw new ApiError(404, '場面のポスターがありません');
    try { return await this.store.read(scene.posterStorageKey, { verifyIntegrity: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, '場面のポスターがありません');
      throw error;
    }
  }

  private async cleanupScenePoster(sceneId: string, key: string | null | undefined) {
    if (!key) return;
    try { await this.store.delete(key, { integrity: true }); }
    catch (err) { logger.warn({ sceneId, err }, 'Procedure video scene poster cleanup failed'); }
  }

  private async generateScenePoster(videoId: string, sceneId: string, startSeconds: number, storageKey: string | null): Promise<boolean> {
    let directory: string | undefined;
    let posterStorageKey: string | undefined;
    try {
      if (!storageKey) throw new Error('Procedure video MP4 is missing');
      directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-scene-'));
      const input = path.join(directory, 'video.mp4'), poster = path.join(directory, 'poster.jpg');
      await writeFile(input, await this.store.read(storageKey, { verifyIntegrity: true }));
      await this.transcoder.posterAt(input, poster, startSeconds);
      // Each attempt owns its file, so stale attempts can safely delete their output.
      posterStorageKey = `procedure-videos/scenes/${sceneId}/${randomUUID()}/poster.jpg`;
      await this.store.write({ key: posterStorageKey, data: await readFile(poster), mode: 'create', integrity: true });
      const changed = await this.db.procedureVideoScene.updateMany({ where: { id: sceneId, videoId, startSeconds, posterStorageKey: null }, data: { posterStorageKey } });
      if (changed.count) return true;
      await this.cleanupScenePoster(sceneId, posterStorageKey);
      posterStorageKey = undefined;
    } catch (err) {
      logger.warn({ videoId, sceneId, err }, 'Procedure video scene poster generation failed');
      await this.cleanupScenePoster(sceneId, posterStorageKey);
    } finally {
      if (directory) {
        try { await rm(directory, { recursive: true, force: true }); }
        catch (err) { logger.warn({ sceneId, err }, 'Procedure video scene temporary cleanup failed'); }
      }
    }
    return false;
  }

  async listComments(id: string) {
    if (!await this.db.procedureVideo.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, '動画がありません');
    return this.db.procedureVideoComment.findMany({ where: { videoId: id }, orderBy: { sortOrder: 'asc' } });
  }

  async replaceComments(id: string, comments: Array<{ atSeconds: number; text: string }>) {
    return runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      const video = await tx.procedureVideo.findUnique({ where: { id } });
      if (!video) throw new ApiError(404, '動画がありません');
      if (video.status !== 'READY') throw new ApiError(409, '完了した動画だけコメントを編集できます');
      const normalized = comments.map((comment) => ({ ...comment, text: comment.text.trim() })).sort((a, b) => a.atSeconds - b.atSeconds);
      if (normalized.length > 5 || normalized.some((comment) => !Number.isFinite(comment.atSeconds) || comment.atSeconds < 0 || video.durationSeconds == null || comment.atSeconds > video.durationSeconds || comment.text.length < 1 || comment.text.length > 80)) {
        throw new ApiError(400, 'コメントは5件まで、動画の範囲内の時刻と1〜80文字で入力してください');
      }
      await tx.procedureVideoComment.deleteMany({ where: { videoId: id } });
      if (normalized.length) await tx.procedureVideoComment.createMany({ data: normalized.map((comment, sortOrder) => ({ videoId: id, ...comment, sortOrder })) });
      return tx.procedureVideoComment.findMany({ where: { videoId: id }, orderBy: { sortOrder: 'asc' } });
    }, this.db);
  }

  async setDiscarded(id: string, discarded: boolean) {
    await runAssemblyTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      if (!await tx.procedureVideo.findUnique({ where: { id } })) throw new ApiError(404, '動画がありません');
      if (discarded && await tx.procedureVideoLink.count({ where: { videoId: id } })) throw new ApiError(409, '紐づいている動画は捨てられません');
      await tx.procedureVideo.update({ where: { id }, data: { discardedAt: discarded ? new Date() : null } });
    }, this.db);
  }

  async listPage(documentId: string, pageIndex: number) {
    const links = await this.db.procedureVideoLink.findMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex }, orderBy: { sortOrder: 'asc' }, include: { video: true, scene: true } });
    return links.map(videoSummary);
  }

  async replacePage(params: AssemblyProcedureEditActor & { documentId: string; pageIndex: number; videoIds?: string[]; items?: Array<{ videoId: string; sceneId?: string | null }>; accessPassword?: string }) {
    await this.access.requireAccessPassword(params.accessPassword);
    if ((params.videoIds == null) === (params.items == null)) throw new ApiError(400, 'videoIdsかitemsのどちらかを指定してください');
    const items = params.items?.map((item) => ({ videoId: item.videoId, sceneId: item.sceneId ?? null })) ?? params.videoIds!.map((videoId) => ({ videoId, sceneId: null }));
    if (items.length > 50 || new Set(items.map((item) => `${item.videoId}:${item.sceneId ?? ''}`)).size !== items.length) throw new ApiError(400, '動画が重複しているか、50件を超えています');
    await runAssemblyTransaction(async (tx) => {
      const [document] = await tx.$queryRaw<Array<{ status: string; isActive: boolean; isRevisionHead: boolean | null }>>`
        SELECT d."status", d."isActive", r."isRevisionHead" FROM "AssemblyProcedureDocument" d
        LEFT JOIN "AssemblyProcedureDocumentRevision" r ON r."documentId" = d."id"
        WHERE d."id" = ${params.documentId} FOR UPDATE OF d`;
      if (!document) throw new ApiError(404, '手順書が見つかりません');
      await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(params.documentId, params.holderKey ?? null, tx, params.holderToken ?? null);
      if (document.status !== 'DRAFT' || !document.isActive || !document.isRevisionHead) throw new ApiError(409, '最新版の改版下書きだけ編集できます');
      if (!await tx.assemblyProcedureDocumentPage.findUnique({ where: { documentId_pageIndex: { documentId: params.documentId, pageIndex: params.pageIndex } } })) throw new ApiError(400, '指定ページが存在しません');
      const ids = [...new Set(items.map((item) => item.videoId))];
      // Stable lock order serializes with discard without locking unrelated videos.
      for (const id of [...ids].sort()) {
        // eslint-disable-next-line no-await-in-loop
        await tx.$queryRaw`SELECT "id" FROM "ProcedureVideo" WHERE "id" = ${id} FOR UPDATE`;
      }
      if (await tx.procedureVideo.count({ where: { id: { in: ids }, discardedAt: null } }) !== ids.length) throw new ApiError(409, '動画がないか、捨てられています');
      const unfinished = await tx.procedureVideo.findFirst({ where: { id: { in: ids }, OR: [{ status: { not: 'READY' } }, { durationSeconds: null }] } });
      if (unfinished) throw new ApiError(409, '変換が終わってから紐づけてください');
      // A trim may have entered PENDING while a page editor held an old shelf snapshot.
      const trimming = await tx.procedureVideo.findFirst({ where: { id: { in: ids }, trimRequest: { not: Prisma.DbNull } } });
      if (trimming) throw new ApiError(409, 'トリミング処理中の動画は紐づけできません');
      const sceneItems = items.filter((item) => item.sceneId != null);
      if (sceneItems.length && await tx.procedureVideoScene.count({ where: { OR: sceneItems.map((item) => ({ id: item.sceneId!, videoId: item.videoId })) } }) !== sceneItems.length) throw new ApiError(400, '指定した場面は動画に属していません');
      await tx.procedureVideoLink.deleteMany({ where: { assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex } });
      if (items.length) await tx.procedureVideoLink.createMany({ data: items.map((item, sortOrder) => ({ ...item, sortOrder, assemblyProcedureDocumentId: params.documentId, pageIndex: params.pageIndex })) });
    }, this.db);
    return this.listPage(params.documentId, params.pageIndex);
  }
}
