import { createHash, randomUUID } from 'node:crypto';

import type { KnowledgeProcedureBoard, Prisma, PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

import { knowledgeSourceSchema } from './knowledge-source.js';
import { emptyLayout, layoutSchema, type BoardLayout } from './procedure-board-layout.js';
import { boardConflict, boardItems, decisionsSchema, emptyDecisions, invalidBoard, same, validateLayoutEvent, type BoardEvent } from './procedure-board.service.js';
import { cumulativeStats, weeklyMetrics, type RecordedBoardEvent } from './procedure-board-metrics.js';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notFound = (): never => { throw new ApiError(404, '盤面または案件が見つかりません'); };
const layoutHash = (layout: BoardLayout) => createHash('sha256').update(JSON.stringify(layoutSchema.parse(layout))).digest('hex');
const decode = (board: KnowledgeProcedureBoard) => ({ boardId: board.id, procedureId: board.procedureId, version: board.version,
  layout: layoutSchema.parse(board.layout), decisions: decisionsSchema.parse(board.decisions), materialFingerprint: board.materialFingerprint,
  ai: { status: 'unavailable' as const } });

export class PrismaProcedureBoardRepository {
  constructor(private readonly db: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  private async procedure(tx: Prisma.TransactionClient, procedureId: string) {
    if (!await tx.knowledgeProcedure.findUnique({ where: { id: procedureId }, select: { id: true } })) notFound();
  }
  private async board(tx: Prisma.TransactionClient, procedureId: string) {
    const board = await tx.knowledgeProcedureBoard.findUnique({ where: { procedureId } });
    return board ?? notFound();
  }
  private async materialsOf(tx: Prisma.TransactionClient, procedureId: string) {
    const materials = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await tx.knowledgeProcedureMaterial.findMany({ where: { procedureId, state: 'assigned' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      materials.push(...page);
      if (page.length < 100) break;
      cursor = page[page.length - 1].id;
    }
    return materials;
  }
  private fingerprint(materials: Awaited<ReturnType<PrismaProcedureBoardRepository['materialsOf']>>) {
    return createHash('sha256').update(JSON.stringify(materials.map(row => ({ id: row.id, source: asJson(row.source), updatedAt: row.updatedAt.toISOString() })))).digest('hex');
  }
  async listProcedures(cursor: string | undefined, limit: number) {
    const rows = await this.db.knowledgeProcedure.findMany({ orderBy: { id: 'asc' }, take: limit + 1,
      ...(cursor ? { where: { id: { gt: cursor } } } : {}), select: { id: true, title: true, board: { select: { id: true } } } });
    return { procedures: rows.slice(0, limit).map(row => ({ procedureId: row.id, title: row.title, boardId: row.board?.id ?? null })), nextCursor: rows.length > limit ? rows[limit - 1].id : null };
  }
  async getOrCreate(procedureId: string, clientDeviceId: string) {
    // upsert's unique procedureId also serializes simultaneous creation.
    const run = () => this.db.$transaction(async tx => {
      await this.procedure(tx, procedureId);
      const prior = await tx.knowledgeProcedureBoard.findUnique({ where: { procedureId } });
      const fingerprint = this.fingerprint(await this.materialsOf(tx, procedureId));
      const id = randomUUID();
      const board = await tx.knowledgeProcedureBoard.upsert({ where: { procedureId }, update: {}, create: {
        id, procedureId, layout: asJson(emptyLayout()), decisions: asJson(emptyDecisions()), materialFingerprint: fingerprint, lastRequestedClientDeviceId: clientDeviceId,
      } });
      return { ...decode(board), created: !prior && board.id === id };
    });
    try { return await run(); } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return { ...decode(await this.board(this.db, procedureId)), created: false };
    }
  }
  async refreshMaterials(procedureId: string) {
    return this.db.$transaction(async tx => {
      const board = await this.board(tx, procedureId);
      const fingerprint = this.fingerprint(await this.materialsOf(tx, procedureId));
      if (board.materialFingerprint !== fingerprint) {
        await tx.knowledgeProcedureBoard.updateMany({ where: { id: board.id, version: board.version, materialFingerprint: board.materialFingerprint },
          data: { materialFingerprint: fingerprint, version: { increment: 1 } } });
      }
      return this.board(tx, procedureId);
    });
  }
  async get(procedureId: string) {
    const board = await this.refreshMaterials(procedureId);
    return this.response(board);
  }
  async materials(procedureId: string, cursor: string | undefined, limit: number) {
    return this.db.$transaction(async tx => {
      await this.procedure(tx, procedureId);
      const materials = await this.materialsOf(tx, procedureId);
      const index = cursor ? materials.findIndex(row => row.id === cursor) + 1 : 0;
      if (cursor && index === 0) notFound();
      const page = materials.slice(index, index + limit);
      return { materials: page.map(row => { const source = knowledgeSourceSchema.parse(row.source);
        return { materialId: row.id, createdAt: row.createdAt.toISOString(), text: source.text,
          images: source.images.map(image => ({ id: image.id })), pdf: source.pdf ?? null };
      }), nextCursor: index + limit < materials.length ? page[page.length - 1].id : null, materialFingerprint: this.fingerprint(materials) };
    });
  }
  async image(procedureId: string, materialId: string, imageId: string) {
    const material = await this.db.knowledgeProcedureMaterial.findFirst({ where: { id: materialId, procedureId, state: 'assigned' } });
    if (!material || !knowledgeSourceSchema.parse(material.source).images.some(image => image.id === imageId)) notFound();
  }
  private async validateMaterials(tx: Prisma.TransactionClient, procedureId: string, layout: BoardLayout) {
    const ids = [...new Set(boardItems(layout).flatMap(({ item }) => item.kind === 'material' ? [item.materialId] : []))];
    const count = await tx.knowledgeProcedureMaterial.count({ where: { id: { in: ids }, procedureId, state: 'assigned' } });
    if (count !== ids.length) invalidBoard('案件に割り当てられた素材だけを配置してください');
  }
  private async validateWork(tx: Prisma.TransactionClient, board: KnowledgeProcedureBoard, clientDeviceId: string, event: BoardEvent, now: Date) {
    if (!('workId' in event.payload) || !event.payload.workId) return;
    const { workId, activeMs, materialId } = event.payload;
    if (!materialId) invalidBoard('素材の作業時間だけを記録できます');
    if (!await tx.knowledgeProcedureMaterial.findFirst({ where: { id: materialId, procedureId: board.procedureId, state: 'assigned' } })) invalidBoard();
    const previous = await tx.knowledgeProcedureBoardEvent.findMany({ where: { boardId: board.id, clientDeviceId, payload: { path: ['workId'], equals: workId } }, orderBy: { occurredAt: 'desc' } });
    const last = previous[0];
    if (previous.some(row => (row.payload as Record<string, unknown>).materialId !== materialId)) invalidBoard();
    const weekStart = board.trialStartedAt ? board.trialStartedAt.getTime() + Math.floor((now.getTime() - board.trialStartedAt.getTime()) / 604800000) * 604800000 : 0;
    const priorPayload = last?.payload as Record<string, unknown> | undefined;
    const sameWeek = last && last.occurredAt.getTime() >= weekStart;
    const elapsed = last ? now.getTime() - Math.max(last.occurredAt.getTime(), weekStart) : Math.min(60000, now.getTime() - weekStart);
    const priorMs = sameWeek ? Number(priorPayload?.activeMs ?? 0) : 0;
    if (activeMs === undefined || activeMs < priorMs || activeMs - priorMs > elapsed + 1000) invalidBoard('作業時間が受信間隔と一致しません');
  }
  private async existingEvent(tx: Prisma.TransactionClient, board: KnowledgeProcedureBoard, clientDeviceId: string, version: number, event: BoardEvent) {
    const existing = await tx.knowledgeProcedureBoardEvent.findUnique({ where: { id: event.id } });
    if (!existing) return null;
    if (existing.boardId !== board.id || existing.clientDeviceId !== clientDeviceId || existing.type !== event.type || existing.boardVersion !== version || !same(existing.payload, event.payload)) {
      boardConflict(board.version);
    }
    return existing;
  }
  private async insertEvent(tx: Prisma.TransactionClient, board: KnowledgeProcedureBoard, clientDeviceId: string, version: number, event: BoardEvent, savedLayoutHash: string | null = null) {
    const now = this.now();
    await this.validateWork(tx, board, clientDeviceId, event, now);
    const dedupeKey = event.type === 'placement_shown' ? `show:${board.id}:${event.payload.suggestionSetId}:${event.payload.proposalId}` : null;
    if (dedupeKey) {
      const shown = await tx.knowledgeProcedureBoardEvent.findUnique({ where: { dedupeKey } });
      if (shown) {
        if (shown.boardId !== board.id || !same(shown.payload, event.payload)) boardConflict(board.version);
        return false;
      }
    }
    await tx.knowledgeProcedureBoardEvent.create({ data: { id: event.id, boardId: board.id, boardVersion: version,
      clientDeviceId, type: event.type, dedupeKey, layoutHash: savedLayoutHash, payload: asJson(event.payload), occurredAt: now } });
    return true;
  }
  async save(procedureId: string, clientDeviceId: string, expectedVersion: number, layout: BoardLayout, event: BoardEvent) {
    const hash = layoutHash(layout);
    const run = () => this.db.$transaction(async tx => {
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      const board = await this.board(tx, procedureId);
      const existing = await tx.knowledgeProcedureBoardEvent.findUnique({ where: { id: event.id },
        select: { boardId: true, clientDeviceId: true, layoutHash: true } });
      if (existing) {
        if (existing.boardId !== board.id || existing.clientDeviceId !== clientDeviceId || existing.layoutHash !== hash) boardConflict(board.version);
        return board;
      }
      if (board.version !== expectedVersion) boardConflict(board.version);
      await this.validateMaterials(tx, procedureId, layout);
      validateLayoutEvent(layoutSchema.parse(board.layout), layout, event);
      const changed = await tx.knowledgeProcedureBoard.updateMany({ where: { id: board.id, version: expectedVersion }, data: {
        layout: asJson(layout), version: { increment: 1 }, lastRequestedClientDeviceId: clientDeviceId,
      } });
      if (changed.count !== 1) boardConflict((await this.board(tx, procedureId)).version);
      await this.insertEvent(tx, board, clientDeviceId, expectedVersion + 1, event, hash);
      return this.board(tx, procedureId);
    });
    let board: KnowledgeProcedureBoard;
    try { board = await run(); } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      board = await run();
    }
    return this.response(board);
  }
  private async metricEvents(boardId: string) {
    return this.db.$queryRaw<RecordedBoardEvent[]>`
      SELECT "id", "type", "occurredAt", "clientDeviceId",
        jsonb_build_object(
          'suggestionSetId', "payload"->'suggestionSetId', 'proposalId', "payload"->'proposalId',
          'materialId', "payload"->'materialId', 'workId', "payload"->'workId',
          'activeMs', "payload"->'activeMs', 'completed', "payload"->'completed',
          'unsupportedCount', "payload"->'unsupportedCount'
        ) AS "payload"
      FROM "KnowledgeProcedureBoardEvent" WHERE "boardId" = ${boardId}`;
  }
  private async response(board: KnowledgeProcedureBoard) {
    return { ...decode(board), stats: cumulativeStats(await this.metricEvents(board.id), board.trialStartedAt) };
  }
  async appendEvents(procedureId: string, clientDeviceId: string, version: number, events: BoardEvent[]) {
    const run = () => this.db.$transaction(async tx => {
      const board = await this.board(tx, procedureId);
      // Serialize append batches without changing the board version.
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${board.id} FOR UPDATE`;
      const current = await this.board(tx, procedureId);
      let count = 0;
      for (const event of events) {
        if (await this.existingEvent(tx, current, clientDeviceId, version, event)) continue;
        if (version !== current.version) boardConflict(current.version);
        if (await this.insertEvent(tx, current, clientDeviceId, version, event)) count++;
      }
      return { recorded: count, duplicates: events.length - count };
    });
    try { return await run(); } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return run();
      throw error;
    }
  }
  async startTrial(procedureId: string, clientDeviceId: string, expectedVersion: number, startedAt: Date) {
    return this.db.$transaction(async tx => {
      const board = await this.board(tx, procedureId);
      if (board.trialStartedAt || board.version !== expectedVersion) boardConflict(board.version);
      const result = await tx.knowledgeProcedureBoard.updateMany({ where: { id: board.id, version: expectedVersion, trialStartedAt: null },
        data: { trialStartedAt: startedAt, version: { increment: 1 }, lastRequestedClientDeviceId: clientDeviceId } });
      if (result.count !== 1) boardConflict((await this.board(tx, procedureId)).version);
      return { version: expectedVersion + 1, trialStartedAt: startedAt.toISOString() };
    });
  }
  async weeklyMetrics(procedureId: string, trialStart: Date, weeks: number) {
    const board = await this.board(this.db, procedureId);
    if (board.trialStartedAt?.getTime() !== trialStart.getTime()) invalidBoard('試験開始日時が一致しません');
    return weeklyMetrics(await this.metricEvents(board.id), trialStart, weeks);
  }
}
