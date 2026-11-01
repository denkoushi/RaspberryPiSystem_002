import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type KnowledgeProcedureBoard, type KnowledgeProcedureBoardAi, type PrismaClient } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

import { knowledgeSourceSchema } from './knowledge-source.js';
import { emptyLayout, layoutSchema, placeItem, type BoardLayout } from './procedure-board-layout.js';
import { boardConflict, boardItems, decisionsSchema, emptyDecisions, invalidBoard, same, validateLayoutEvent, suggestionStale, type PlacementDecision, type FormatDecision, type BoardEvent } from './procedure-board.service.js';
import { applyFormatResult, boardAiKindSchema, boardAiStateSchema, validateFormatResult, validatePlacementResult, type BoardAiInput } from './procedure-board-inference.js';
import { cumulativeStats, weeklyMetrics, type RecordedBoardEvent } from './procedure-board-metrics.js';

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function notFound(): never { throw new ApiError(404, '盤面または案件が見つかりません'); }
const layoutHash = (layout: BoardLayout) => createHash('sha256').update(JSON.stringify(layoutSchema.parse(layout))).digest('hex');
const decode = (board: KnowledgeProcedureBoard) => ({ boardId: board.id, procedureId: board.procedureId, version: board.version,
  layout: layoutSchema.parse(board.layout), decisions: decisionsSchema.parse(board.decisions), materialFingerprint: board.materialFingerprint,
  ai: { status: 'pending' as const } });

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
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${board.id} FOR UPDATE`;
      await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      return { ...decode(await this.board(tx, procedureId)), created: !prior && board.id === id };
    });
    try { return await run(); } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return { ...decode(await this.board(this.db, procedureId)), created: false };
    }
  }
  async refreshMaterials(procedureId: string, clientDeviceId?: string) {
    return this.db.$transaction(async tx => {
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      return this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
    });
  }
  async get(procedureId: string, clientDeviceId?: string) {
    return this.response(await this.refreshMaterials(procedureId, clientDeviceId));
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
  private async validateMaterials(tx: Prisma.TransactionClient, procedureId: string, layout: BoardLayout, before: BoardLayout) {
    const existing = boardItems(before);
    const ids = [...new Set(boardItems(layout).flatMap(({ item }) => item.kind === 'material' && !existing.some(old => old.item.itemId === item.itemId && old.item.kind === 'material' && old.item.materialId === item.materialId) ? [item.materialId] : []))];
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
      const board = await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      const existing = await tx.knowledgeProcedureBoardEvent.findUnique({ where: { id: event.id },
        select: { boardId: true, clientDeviceId: true, layoutHash: true } });
      if (existing) {
        if (existing.boardId !== board.id || existing.clientDeviceId !== clientDeviceId || existing.layoutHash !== hash) boardConflict(board.version);
        return board;
      }
      if (board.version !== expectedVersion) boardConflict(board.version);
      await this.validateMaterials(tx, procedureId, layout, layoutSchema.parse(board.layout));
      validateLayoutEvent(layoutSchema.parse(board.layout), layout, event);
      const changed = await tx.knowledgeProcedureBoard.updateMany({ where: { id: board.id, version: expectedVersion }, data: {
        layout: asJson(layout), version: { increment: 1 }, lastRequestedClientDeviceId: clientDeviceId,
      } });
      if (changed.count !== 1) boardConflict((await this.board(tx, procedureId)).version);
      await this.insertEvent(tx, board, clientDeviceId, expectedVersion + 1, event, hash);
      return this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
    });
    let board: KnowledgeProcedureBoard;
    try { board = await run(); } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      board = await run();
    }
    return this.response(board);
  }
  private snapshot(board: KnowledgeProcedureBoard, materials: Awaited<ReturnType<PrismaProcedureBoardRepository['materialsOf']>>): BoardAiInput {
    return { layout: layoutSchema.parse(board.layout), decisions: decisionsSchema.parse(board.decisions), materialFingerprint: board.materialFingerprint,
      materials: materials.map(row => ({ materialId: row.id, materialFingerprint: this.fingerprint([row]), source: knowledgeSourceSchema.parse(row.source),
        derived: { label: 'AI-generated; not original facts', organized: row.organized } })) };
  }
  private async refreshLocked(tx: Prisma.TransactionClient, board: KnowledgeProcedureBoard, clientDeviceId?: string) {
    const legacy = layoutSchema.parse(board.layout);
    const decisions = decisionsSchema.parse(board.decisions);
    const itemIds: string[] = [];
    for (const page of legacy.pages) {
      if (!page.heading) continue;
      const itemId = randomUUID(); itemIds.push(itemId);
      decisions.acceptedHeadings.push({ page: page.page, text: page.heading });
      page.rows.unshift({ cols: [{ items: [{ itemId, kind: 'text', textKind: 'title', style: 'heading', text: page.heading, origin: 'ai-accepted' }] }], w: [1] });
      page.heading = '';
    }
    if (itemIds.length) {
      const layout = layoutSchema.parse(legacy);
      const actor = clientDeviceId ?? board.lastRequestedClientDeviceId;
      board = await tx.knowledgeProcedureBoard.update({ where: { id: board.id }, data: {
        layout: asJson(layout), decisions: asJson(decisionsSchema.parse(decisions)), version: { increment: 1 },
      } });
      await this.insertEvent(tx, board, actor, board.version, { id: randomUUID(), type: 'headings_migrated', payload: { itemIds } }, layoutHash(layout));
    }
    const materials = await this.materialsOf(tx, board.procedureId);
    const fingerprint = this.fingerprint(materials);
    if (fingerprint !== board.materialFingerprint || (clientDeviceId && board.lastRequestedClientDeviceId !== clientDeviceId)) {
      board = await tx.knowledgeProcedureBoard.update({ where: { id: board.id }, data: {
        ...(fingerprint !== board.materialFingerprint ? { materialFingerprint: fingerprint, version: { increment: 1 } } : {}),
        ...(clientDeviceId ? { lastRequestedClientDeviceId: clientDeviceId } : {}),
      } });
    }
    await tx.knowledgeProcedureBoardAi.updateMany({ where: { boardId: board.id, boardVersion: { not: board.version },
      state: { in: ['pending', 'running', 'ready', 'deferred', 'failed'] } }, data: { state: 'stale' } });
    await tx.knowledgeProcedureBoardAi.upsert({ where: { boardId_kind_requestKey: { boardId: board.id, kind: 'placement', requestKey: String(board.version) } },
      update: clientDeviceId ? { requestedByClientDeviceId: clientDeviceId } : {},
      create: { id: randomUUID(), boardId: board.id, boardVersion: board.version, kind: 'placement', requestKey: String(board.version),
        requestedByClientDeviceId: board.lastRequestedClientDeviceId, input: asJson(this.snapshot(board, materials)), retryAt: this.now() } });
    return board;
  }
  async enqueueAi(procedureId: string, clientDeviceId: string, kind: 'placement' | 'format' = 'placement', requestKey?: string, expectedVersion?: number) {
    const run = () => this.db.$transaction(async tx => {
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      const board = await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      const key = kind === 'placement' ? String(board.version) : requestKey!;
      const existing = await tx.knowledgeProcedureBoardAi.findUnique({ where: { boardId_kind_requestKey: { boardId: board.id, kind, requestKey: key } } });
      if (existing) {
        if (kind === 'format' && (existing.boardVersion !== expectedVersion || existing.requestedByClientDeviceId !== clientDeviceId)) boardConflict(board.version);
        return { proposalId: existing.id, boardVersion: existing.boardVersion, status: boardAiStateSchema.parse(existing.state), pollAfterMs: 5000 };
      }
      if (kind === 'format' && await tx.knowledgeProcedureBoardEvent.findUnique({ where: { id: key } })) boardConflict(board.version);
      if (expectedVersion !== undefined && expectedVersion !== board.version) boardConflict(board.version);
      const job = await tx.knowledgeProcedureBoardAi.create({ data: { id: randomUUID(), boardId: board.id, boardVersion: board.version, kind,
        requestKey: key, requestedByClientDeviceId: clientDeviceId, retryAt: this.now(), input: asJson(this.snapshot(board, await this.materialsOf(tx, procedureId))) } });
      await this.insertEvent(tx, board, clientDeviceId, board.version, { id: key, type: 'format_requested', payload: { suggestionSetId: job.id } });
      return { proposalId: job.id, boardVersion: job.boardVersion, status: boardAiStateSchema.parse(job.state), pollAfterMs: 5000 };
    });
    try { return await run(); } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      return run();
    }
  }
  private sweepCursor: string | undefined;
  async refreshAi() {
    const boards = await this.db.knowledgeProcedureBoard.findMany({ where: this.sweepCursor ? { id: { gt: this.sweepCursor } } : {}, orderBy: { id: 'asc' }, take: 20, select: { id: true, procedureId: true } });
    for (const board of boards) await this.refreshMaterials(board.procedureId);
    this.sweepCursor = boards.length === 20 ? boards[19].id : undefined;
  }
  async aiClientEnabled(clientDeviceId: string) {
    return (await this.db.clientDevice.findUnique({ where: { id: clientDeviceId }, select: { procedureBoardEnabled: true } }))?.procedureBoardEnabled === true;
  }
  async claimAi(leaseToken: string) {
    const now = this.now();
    const eligible = { OR: [{ state: { in: ['pending', 'deferred'] }, retryAt: { lte: now } }, { state: 'running', leaseUntil: { lte: now } }] };
    const candidate = await this.db.knowledgeProcedureBoardAi.findFirst({ where: eligible, orderBy: [{ retryAt: 'asc' }, { createdAt: 'asc' }] });
    if (!candidate) return null;
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${candidate.boardId} FOR UPDATE`;
      const prior = await tx.knowledgeProcedureBoard.findUniqueOrThrow({ where: { id: candidate.boardId } });
      const board = await this.refreshLocked(tx, prior);
      const input = candidate.input as unknown as BoardAiInput;
      if (board.version !== candidate.boardVersion || board.materialFingerprint !== input.materialFingerprint) return null;
      const claimed = await tx.knowledgeProcedureBoardAi.updateMany({ where: { id: candidate.id, ...eligible }, data: {
        state: 'running', leaseToken, leaseUntil: new Date(now.getTime() + 660000), attempts: { increment: 1 }, errorCode: null,
      } });
      if (claimed.count !== 1) return null;
      const job = await tx.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: candidate.id } });
      return { ...job, kind: boardAiKindSchema.parse(job.kind), state: boardAiStateSchema.parse(job.state), input: job.input as unknown as BoardAiInput };
    });
  }
  async saveAiResult(id: string, leaseToken: string, boardVersion: number, result: unknown) {
    return this.db.$transaction(async tx => {
      const job = await tx.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id } });
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${job.boardId} FOR UPDATE`;
      const board = await this.refreshLocked(tx, await tx.knowledgeProcedureBoard.findUniqueOrThrow({ where: { id: job.boardId } }));
      const current = await tx.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id } });
      if (current.leaseToken !== leaseToken || !current.leaseUntil || current.leaseUntil <= this.now() || !['running', 'stale'].includes(current.state)) return false;
      const input = current.input as unknown as BoardAiInput;
      const validated = current.kind === 'placement' ? validatePlacementResult(result, input) : validateFormatResult(result, input);
      const stale = board.version !== boardVersion || current.boardVersion !== boardVersion || input.materialFingerprint !== board.materialFingerprint;
      await tx.knowledgeProcedureBoardAi.update({ where: { id }, data: { result: asJson(validated), state: stale ? 'stale' : 'ready', leaseToken: null, leaseUntil: null } });
      return true;
    });
  }
  async deferAi(id: string, leaseToken: string, code: string, deferred = true) {
    const job = await this.db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id } });
    const disabled = code === 'PROCEDURE_BOARD_CLIENT_DISABLED';
    const delay = disabled ? 30000 : Math.min(300000, 30000 * 2 ** Math.min(4, Math.max(0, job.attempts - 1)));
    await this.db.knowledgeProcedureBoardAi.updateMany({ where: { id, leaseToken, state: 'running' }, data: {
      ...(disabled ? { attempts: Math.max(0, job.attempts - 1) } : {}),
      state: deferred ? 'deferred' : 'failed', errorCode: code, retryAt: new Date(this.now().getTime() + delay), leaseToken: null, leaseUntil: null,
    } });
  }
  async suggestions(procedureId: string, clientDeviceId: string) {
    const board = await this.refreshMaterials(procedureId, clientDeviceId);
    const [current, previous] = await Promise.all([
      this.db.knowledgeProcedureBoardAi.findUnique({ where: { boardId_kind_requestKey: { boardId: board.id, kind: 'placement', requestKey: String(board.version) } } }),
      this.db.knowledgeProcedureBoardAi.findFirst({ where: { boardId: board.id, kind: 'placement', boardVersion: { lt: board.version }, result: { not: Prisma.DbNull } }, orderBy: { boardVersion: 'desc' } }),
    ]);
    const input = this.snapshot(board, await this.materialsOf(this.db, procedureId));
    const view = (job: KnowledgeProcedureBoardAi, stale: boolean) => ({ id: job.id, boardVersion: job.boardVersion, ...(stale ? { stale: true } : {}), ...validatePlacementResult(job.result, input) });
    return { boardVersion: board.version, status: current ? boardAiStateSchema.parse(current.state) : 'pending',
      current: current?.state === 'ready' ? view(current, false) : null, previous: previous ? view(previous, true) : null,
      pollAfterMs: current?.state === 'deferred' ? 10000 : 5000 };
  }
  async formatProposal(procedureId: string, id: string, clientDeviceId: string) {
    const board = await this.refreshMaterials(procedureId, clientDeviceId);
    const job = await this.db.knowledgeProcedureBoardAi.findFirst({ where: { id, boardId: board.id, kind: 'format' } });
    if (!job) notFound();
    return { proposalId: id, boardVersion: job.boardVersion, status: boardAiStateSchema.parse(job.state), result: job.result, pollAfterMs: 5000 };
  }
  private async decisionReplay(tx: Prisma.TransactionClient, board: KnowledgeProcedureBoard, clientDeviceId: string, id: string, hash: string) {
    const event = await tx.knowledgeProcedureBoardEvent.findUnique({ where: { id } });
    if (!event) return false;
    if (event.boardId !== board.id || event.clientDeviceId !== clientDeviceId || event.layoutHash !== hash) boardConflict(board.version);
    return true;
  }
  async decidePlacement(procedureId: string, clientDeviceId: string, id: string, input: PlacementDecision) {
    const board = await this.db.$transaction(async tx => {
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      const board = await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      const hash = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
      if (await this.decisionReplay(tx, board, clientDeviceId, input.eventId, hash)) return board;
      const job = await tx.knowledgeProcedureBoardAi.findFirst({ where: { id, boardId: board.id, kind: 'placement' } });
      if (!job) notFound();
      if (job.state !== 'ready' || job.boardVersion !== board.version || input.expectedVersion !== board.version) suggestionStale();
      const snapshot = this.snapshot(board, await this.materialsOf(tx, procedureId));
      const result = validatePlacementResult(job.result, snapshot);
      const placement = result.placements.find(proposal => proposal.id === input.proposalId);
      const heading = result.headings.find(proposal => proposal.id === input.proposalId);
      const conflict = result.conflicts.find(proposal => proposal.id === input.proposalId);
      let layout = layoutSchema.parse(board.layout);
      const decisions = decisionsSchema.parse(board.decisions);
      const base = { suggestionSetId: id, proposalId: input.proposalId };
      let event: BoardEvent;
      if (placement && ['accept', 'dismiss', 'relocate'].includes(input.action)) {
        const material = snapshot.materials.find(material => material.materialId === placement.materialId)!;
        const work = { ...(input.workId ? { workId: input.workId, activeMs: input.activeMs } : {}) };
        if (input.action === 'dismiss') {
          decisions.dismissedPlacements.push({ materialId: material.materialId, materialFingerprint: material.materialFingerprint });
          event = { id: input.eventId, type: 'placement_dismissed', payload: { ...base, materialId: material.materialId, ...work } };
        } else {
          if (!input.itemId || boardItems(layout).some(entry => entry.item.itemId === input.itemId)) invalidBoard();
          const target = input.action === 'relocate' ? input.target! : { page: placement.page, row: placement.row, col: placement.col, index: placement.index, mode: placement.mode };
          if (input.action === 'relocate' && same(target, { page: placement.page, row: placement.row, col: placement.col, index: placement.index, mode: placement.mode })) invalidBoard();
          try { layout = placeItem(layout, { itemId: input.itemId, kind: 'material', materialId: material.materialId, origin: 'ai-accepted', style: material.source.images.length ? 'figure' : 'body' }, target); }
          catch { invalidBoard(); }
          const at = boardItems(layout).find(entry => entry.item.itemId === input.itemId)!.at;
          if (input.action === 'accept' && !await tx.knowledgeProcedureBoardEvent.findUnique({ where: { dedupeKey: `show:${board.id}:${id}:${placement.id}` } })) invalidBoard('先に提案表示を記録してください');
          event = { id: input.eventId, type: input.action === 'accept' ? 'placement_accepted' : 'ghost_relocated', payload: { ...base, materialId: material.materialId, itemId: input.itemId, to: at, ...work } };
        }
      } else if (heading && ['accept', 'dismiss', 'relocate'].includes(input.action) && !input.workId) {
        if (input.action === 'dismiss') {
          if (input.itemId) invalidBoard();
          decisions.dismissedHeadings.push({ page: heading.page, text: heading.text });
          event = { id: input.eventId, type: 'heading_dismissed', payload: base };
        } else {
          if (!input.itemId || boardItems(layout).some(entry => entry.item.itemId === input.itemId)) invalidBoard();
          const proposed = { page: heading.page, row: 0, col: 0, index: 0, mode: 'row' as const };
          const target = input.action === 'relocate' ? input.target! : proposed;
          if (input.action === 'relocate' && same(target, proposed)) invalidBoard();
          try { layout = placeItem(layout, { itemId: input.itemId, kind: 'text', textKind: 'title', style: 'heading', text: heading.text, origin: 'ai-accepted' }, target); }
          catch { invalidBoard(); }
          decisions.acceptedHeadings.push({ page: heading.page, text: heading.text });
          const to = boardItems(layout).find(entry => entry.item.itemId === input.itemId)!.at;
          event = { id: input.eventId, type: input.action === 'accept' ? 'heading_accepted' : 'ghost_relocated', payload: { ...base, itemId: input.itemId, to } };
        }
      } else if (conflict && input.action === 'select_conflict' && !input.itemId && !input.workId) {
        if (input.selectedMaterialId !== null && !conflict.materialIds.includes(input.selectedMaterialId!)) invalidBoard();
        decisions.conflicts = decisions.conflicts.filter(entry => !entry.materialIds.every(materialId => conflict.materialIds.includes(materialId)));
        decisions.conflicts.push({ materialIds: conflict.materialIds, selectedMaterialId: input.selectedMaterialId! });
        event = { id: input.eventId, type: 'conflict_selected', payload: { ...base, selectedMaterialId: input.selectedMaterialId! } };
      } else invalidBoard();
      await tx.knowledgeProcedureBoard.update({ where: { id: board.id }, data: { layout: asJson(layout), decisions: asJson(decisionsSchema.parse(decisions)), version: { increment: 1 } } });
      await this.insertEvent(tx, board, clientDeviceId, board.version + 1, event, hash);
      return this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
    });
    return this.response(board);
  }
  async decideFormat(procedureId: string, clientDeviceId: string, id: string, input: FormatDecision) {
    const result = await this.db.$transaction(async tx => {
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      const current = await this.board(tx, procedureId);
      const board = input.action === 'revert' ? current : await this.refreshLocked(tx, current, clientDeviceId);
      const hash = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
      const job = await tx.knowledgeProcedureBoardAi.findFirst({ where: { id, boardId: board.id, kind: 'format' } });
      if (!job) notFound();
      if (await this.decisionReplay(tx, board, clientDeviceId, input.eventId, hash)) return { board, state: job.state };
      if (input.action === 'accept' && (job.state !== 'ready' || job.boardVersion !== board.version || input.expectedVersion !== board.version)) suggestionStale();
      if (['accepted', 'reverted'].includes(job.state)
        || (input.expectedVersion !== job.boardVersion && input.expectedVersion !== board.version)) suggestionStale();
      const layout = input.action === 'accept' ? applyFormatResult(job.result, layoutSchema.parse(board.layout)) : layoutSchema.parse(board.layout);
      const state = input.action === 'accept' ? 'accepted' : 'reverted';
      await tx.knowledgeProcedureBoardAi.update({ where: { id }, data: { state, leaseToken: null, leaseUntil: null } });
      if (input.action === 'accept') await tx.knowledgeProcedureBoard.update({ where: { id: board.id }, data: { layout: asJson(layout), version: { increment: 1 } } });
      await this.insertEvent(tx, board, clientDeviceId, board.version + (input.action === 'accept' ? 1 : 0),
        { id: input.eventId, type: input.action === 'accept' ? 'format_accepted' : 'format_reverted', payload: { suggestionSetId: id } }, hash);
      return { board: input.action === 'revert' ? board : await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId), state };
    });
    return { ...await this.response(result.board), proposalId: id, state: result.state };
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
    const job = await this.db.knowledgeProcedureBoardAi.findUnique({ where: { boardId_kind_requestKey: { boardId: board.id, kind: 'placement', requestKey: String(board.version) } } });
    return { ...decode(board), ai: { status: job ? boardAiStateSchema.parse(job.state) : 'pending' }, stats: cumulativeStats(await this.metricEvents(board.id), board.trialStartedAt) };
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
      const prior = await this.board(tx, procedureId);
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeProcedureBoard" WHERE "id" = ${prior.id} FOR UPDATE`;
      const board = await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      if (board.trialStartedAt || board.version !== expectedVersion) boardConflict(board.version);
      const result = await tx.knowledgeProcedureBoard.updateMany({ where: { id: board.id, version: expectedVersion, trialStartedAt: null },
        data: { trialStartedAt: startedAt, version: { increment: 1 }, lastRequestedClientDeviceId: clientDeviceId } });
      if (result.count !== 1) boardConflict((await this.board(tx, procedureId)).version);
      await this.refreshLocked(tx, await this.board(tx, procedureId), clientDeviceId);
      return { version: expectedVersion + 1, trialStartedAt: startedAt.toISOString() };
    });
  }
  async weeklyMetrics(procedureId: string, trialStart: Date, weeks: number) {
    const board = await this.board(this.db, procedureId);
    if (board.trialStartedAt?.getTime() !== trialStart.getTime()) invalidBoard('試験開始日時が一致しません');
    return weeklyMetrics(await this.metricEvents(board.id), trialStart, weeks);
  }
}
