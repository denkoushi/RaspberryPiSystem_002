import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../../lib/prisma-client.js';
import { emptyLayout, placeItem, type BoardItem } from '../procedure-board-layout.js';
import { PrismaProcedureBoardRepository } from '../prisma-procedure-board.repository.js';

const enabled = process.env.KNOWLEDGE_DATABASE_TEST === '1';
// Fixed disposable loopback database; never inherit the application's DATABASE_URL.
const db = createPrismaClient('postgresql://postgres:disposable-test@127.0.0.1:25433/knowledge_test');
let now = new Date('2026-11-01T00:00:00Z');
const repository = new PrismaProcedureBoardRepository(db, () => now);
const procedureId = `board-test-${randomUUID()}`;
const otherId = `board-test-${randomUUID()}`;
const revisionId = randomUUID();
const materialId = randomUUID();
const foreignMaterialId = randomUUID();
const source = { id: randomUUID(), text: '受検料を確認する', capturedAt: '2026-10-31T00:00:00Z', images: [] };
const item: BoardItem = { itemId: randomUUID(), kind: 'material', materialId, origin: 'human', style: 'body' };
const at = { page: 1, row: 0, col: 0, index: 0 };

describe.skipIf(!enabled)('Procedure board PostgreSQL contract', () => {
  beforeAll(async () => {
    await db.knowledgeProcedure.createMany({ data: [procedureId, otherId].map(id => ({ id, title: '手順づくり試験', category: '試験', reviewTier: 'approval_required' })) });
    await db.knowledgeProcedureRevision.create({ data: { id: revisionId, procedureId, revisionNumber: 1, state: 'published', content: { formatVersion: 1, steps: [] }, createdByKey: 'board-local-test' } });
    await db.knowledgeProcedure.update({ where: { id: procedureId }, data: { publishedRevisionId: revisionId } });
    await db.knowledgeProcedureMaterial.createMany({ data: [
      { id: materialId, intakeId: 'board-local-test', sourceId: source.id, source, organized: {}, state: 'assigned', procedureId },
      { id: foreignMaterialId, intakeId: 'board-local-test', sourceId: randomUUID(), source, organized: {}, state: 'assigned', procedureId: otherId },
    ] });
  });
  afterAll(async () => {
    // Restrict cleanup to this fixture, in foreign-key order.
    const boards = await db.knowledgeProcedureBoard.findMany({ where: { procedureId: { in: [procedureId, otherId] } }, select: { id: true } });
    await db.knowledgeProcedureBoardAi.deleteMany({ where: { boardId: { in: boards.map(row => row.id) } } });
    await db.knowledgeProcedureBoardEvent.deleteMany({ where: { boardId: { in: boards.map(row => row.id) } } });
    await db.knowledgeProcedureBoard.deleteMany({ where: { procedureId: { in: [procedureId, otherId] } } });
    await db.knowledgeProcedureMaterial.deleteMany({ where: { id: { in: [materialId, foreignMaterialId] } } });
    await db.knowledgeProcedure.updateMany({ where: { id: procedureId }, data: { publishedRevisionId: null } });
    await db.knowledgeProcedureRevision.deleteMany({ where: { id: revisionId } });
    await db.knowledgeProcedure.deleteMany({ where: { id: { in: [procedureId, otherId] } } });
    await db.$disconnect();
  });
  it('does not create on GET, creates once concurrently, rejects foreign materials and CAS races', async () => {
    await expect(repository.get(procedureId)).rejects.toMatchObject({ statusCode: 404 });
    const created = await Promise.all([repository.getOrCreate(procedureId, 'client-1'), repository.getOrCreate(procedureId, 'client-2')]);
    expect(new Set(created.map(row => row.boardId)).size).toBe(1);
    expect(created.filter(row => row.created)).toHaveLength(1);
    const layout = placeItem(emptyLayout(), item, { ...at, mode: 'row' });
    const event = { id: randomUUID(), type: 'material_placed' as const, payload: { itemId: item.itemId, materialId, to: at } };
    const foreign = placeItem(emptyLayout(), { ...item, materialId: foreignMaterialId }, { ...at, mode: 'row' });
    await expect(repository.save(procedureId, 'client-1', 1, foreign, { ...event, payload: { ...event.payload, materialId: foreignMaterialId } })).rejects.toMatchObject({ statusCode: 400 });
    const results = await Promise.allSettled([repository.save(procedureId, 'client-1', 1, layout, event), repository.save(procedureId, 'client-2', 1, layout, { ...event, id: randomUUID() })]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(row => row.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    const board = await repository.get(procedureId);
    expect(board.version).toBe(2);
    const saved = await db.knowledgeProcedureBoardEvent.findFirstOrThrow({ where: { boardId: board.boardId } });
    expect(await db.knowledgeProcedureBoardEvent.count({ where: { boardId: board.boardId } })).toBe(1);
    const originalResponse = await repository.save(procedureId, saved.clientDeviceId, 1, layout, { ...event, id: saved.id });
    expect(originalResponse.version).toBe(2);
    const edited = structuredClone(layout); const reference = edited.pages[0].rows[0].cols[0].items[0];
    if (reference.kind === 'material') reference.override = '確認した受検料';
    const revisions = await db.knowledgeProcedureRevision.findMany({ where: { procedureId } });
    await repository.save(procedureId, 'client-1', 2, edited, { id: randomUUID(), type: 'text_edited', payload: { itemId: item.itemId, materialId } });
    const replay = await repository.save(procedureId, saved.clientDeviceId, 1, layout, { ...event, id: saved.id });
    expect(replay.version).toBe(3);
    expect(replay.layout).toEqual(edited);
    expect(saved.layoutHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.payload).not.toHaveProperty('_save');
    expect(await db.knowledgeProcedureBoardEvent.count({ where: { boardId: board.boardId } })).toBe(2);
    await expect(repository.save(procedureId, saved.clientDeviceId, 1, edited, { ...event, id: saved.id })).rejects.toMatchObject({ statusCode: 409 });
    expect((await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source).toEqual(source);
    expect(await db.knowledgeProcedureRevision.findMany({ where: { procedureId } })).toEqual(revisions);
    expect((await repository.get(procedureId)).layout).toEqual(edited);
  });
  it('records displays once across devices, rejects mutated UUIDs and cumulative time inflation', async () => {
    const board = await repository.get(procedureId);
    const shown = { id: randomUUID(), type: 'placement_shown' as const, payload: { suggestionSetId: 'set-local', proposalId: 'p1', materialId } };
    const displays = await Promise.all([repository.appendEvents(procedureId, 'client-1', board.version, [shown]), repository.appendEvents(procedureId, 'client-2', board.version, [{ ...shown, id: randomUUID() }])]);
    expect(displays.reduce((n, row) => n + row.recorded, 0)).toBe(1);
    const pulse = { id: randomUUID(), type: 'material_work' as const, payload: { workId: randomUUID(), materialId, activeMs: 4200, completed: false } };
    expect(await repository.appendEvents(procedureId, 'client-1', board.version, [pulse])).toEqual({ recorded: 1, duplicates: 0 });
    expect(await repository.appendEvents(procedureId, 'client-1', board.version, [pulse])).toEqual({ recorded: 0, duplicates: 1 });
    await expect(repository.appendEvents(procedureId, 'client-1', board.version, [{ ...pulse, payload: { ...pulse.payload, activeMs: 5000 } }])).rejects.toMatchObject({ statusCode: 409 });
    await expect(repository.appendEvents(procedureId, 'client-1', board.version, [{ ...pulse, id: randomUUID(), payload: { ...pulse.payload, activeMs: 60000 } }])).rejects.toMatchObject({ statusCode: 400 });
    now = new Date(now.getTime() + 10000);
    await repository.appendEvents(procedureId, 'client-1', board.version, [{ ...pulse, id: randomUUID(), payload: { ...pulse.payload, activeMs: 14200, completed: true } }]);
    expect((await repository.get(procedureId)).version).toBe(board.version);
  });
  it('allows manual placement after a shown proposal is dismissed without increasing manual metrics', async () => {
    const board = await repository.get(procedureId);
    const stats = board.stats;
    await db.knowledgeProcedureBoardEvent.create({ data: { id: randomUUID(), boardId: board.boardId,
      boardVersion: board.version, clientDeviceId: 'client-1', type: 'placement_dismissed', occurredAt: now,
      payload: { suggestionSetId: 'set-local', proposalId: 'p1', materialId } } });
    const removed = await repository.save(procedureId, 'client-1', board.version, emptyLayout(), {
      id: randomUUID(), type: 'item_removed', payload: { itemId: item.itemId, materialId },
    });
    const layout = placeItem(emptyLayout(), item, { ...at, mode: 'row' });
    const placed = await repository.save(procedureId, 'client-1', removed.version, layout, {
      id: randomUUID(), type: 'material_placed', payload: { itemId: item.itemId, materialId, to: at },
    });
    expect(placed.layout).toEqual(layout);
    expect(placed.stats.manual).toBe(stats.manual);
  });
  it('deduplicates displays within each board independently', async () => {
    const board = await repository.getOrCreate(otherId, 'client-1');
    const shown = { id: randomUUID(), type: 'placement_shown' as const,
      payload: { suggestionSetId: 'set-local', proposalId: 'p1', materialId } };
    expect(await repository.appendEvents(otherId, 'client-1', board.version, [shown])).toEqual({ recorded: 1, duplicates: 0 });
    expect(await repository.appendEvents(otherId, 'client-2', board.version, [{ ...shown, id: randomUUID() }])).toEqual({ recorded: 0, duplicates: 1 });
    const event = await db.knowledgeProcedureBoardEvent.findUniqueOrThrow({ where: { id: shown.id } });
    expect(event.dedupeKey).toBe(`show:${board.boardId}:set-local:p1`);
  });
  it('refreshes material fingerprints once, fixes trial start once and guards image membership', async () => {
    const old = await repository.get(procedureId);
    await db.knowledgeProcedureMaterial.update({ where: { id: materialId }, data: { source: { ...source, text: '後日更新' } } });
    const refreshed = await Promise.all([repository.get(procedureId), repository.get(procedureId)]);
    expect(refreshed.map(row => row.version)).toEqual([old.version + 1, old.version + 1]);
    expect(refreshed[0].layout).toEqual(old.layout);
    expect((await repository.materials(procedureId, undefined, 100)).materials.map(row => row.materialId)).toEqual([materialId]);
    await expect(repository.image(procedureId, foreignMaterialId, 'a'.repeat(64))).rejects.toMatchObject({ statusCode: 404 });
    const start = new Date('2026-11-01T00:00:00Z');
    const trial = await repository.startTrial(procedureId, 'client-1', old.version + 1, start);
    await expect(repository.startTrial(procedureId, 'client-1', trial.version, start)).rejects.toMatchObject({ statusCode: 409 });
    await expect(repository.weeklyMetrics(procedureId, new Date(0), 4)).rejects.toMatchObject({ statusCode: 400 });
    expect((await repository.weeklyMetrics(procedureId, start, 4)).timezone).toBe('Asia/Tokyo');
  });
  async function placementJob() {
    const board = await repository.get(procedureId);
    const job = await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { boardId_kind_requestKey: { boardId: board.boardId, kind: 'placement', requestKey: String(board.version) } } });
    return { board, job };
  }
  async function claim(id: string, token = randomUUID()) {
    // Prioritize this fixture without touching jobs belonging to another test.
    await db.knowledgeProcedureBoardAi.update({ where: { id }, data: { retryAt: new Date(0) } });
    const job = await repository.claimAi(token);
    expect(job?.id).toBe(id);
    return { job: job!, token };
  }
  const emptyResult = { placements: [], headings: [], gaps: [], conflicts: [] };
  function formatOf(layout: ReturnType<typeof emptyLayout>) {
    return { pages: layout.pages.map(page => ({ page: page.page, rows: page.rows.map(row => ({ w: row.w, cols: row.cols.map(col => ({ itemIds: col.items.map(item => item.itemId) })) })) })), styles: [] };
  }
  it('serializes an existing-board create request with a concurrent save', async () => {
    const board = await repository.get(procedureId);
    const layout = structuredClone(board.layout);
    const entry = layout.pages[0].rows[0].cols[0].items[0];
    if (entry.kind === 'material') entry.override = '同時操作後の本文';
    await Promise.all([
      repository.getOrCreate(procedureId, 'client-2'),
      repository.save(procedureId, 'client-1', board.version, layout, { id: randomUUID(), type: 'text_edited', payload: { itemId: item.itemId, materialId } }),
    ]);
    const current = await placementJob();
    expect(current.board.version).toBe(board.version + 1); expect(current.board.layout).toEqual(layout);
    expect(current.job.state).toBe('pending');
    expect((current.job.input as { layout: unknown }).layout).toEqual(layout);
  });
  it('enqueues once per version, reclaims expired leases, fences old workers, and backs off to five minutes', async () => {
    const { board, job } = await placementJob();
    await Promise.all([repository.enqueueAi(procedureId, 'client-1'), repository.enqueueAi(procedureId, 'client-2')]);
    expect(await db.knowledgeProcedureBoardAi.count({ where: { boardId: board.boardId, kind: 'placement', requestKey: String(board.version) } })).toBe(1);
    const first = await claim(job.id);
    expect(await repository.saveAiResult(job.id, 'wrong-token', board.version, emptyResult)).toBe(false);
    now = new Date(now.getTime() + 660001);
    const second = await claim(job.id);
    expect(second.token).not.toBe(first.token); expect(second.job.attempts).toBe(2);
    expect(await repository.saveAiResult(job.id, first.token, board.version, emptyResult)).toBe(false);
    await repository.deferAi(job.id, second.token, 'WAITING_FOR_INFERENCE');
    let current = await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: job.id } });
    expect(current.state).toBe('deferred'); expect(current.retryAt.getTime() - now.getTime()).toBe(60000);
    for (const delay of [120000, 240000, 300000, 300000]) {
      now = current.retryAt;
      const claimed = await claim(job.id);
      await repository.deferAi(job.id, claimed.token, 'WAITING_FOR_INFERENCE');
      current = await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: job.id } });
      expect(current.retryAt.getTime() - now.getTime()).toBe(delay);
    }
    now = current.retryAt;
    const final = await claim(job.id);
    expect(await repository.saveAiResult(job.id, final.token, board.version, emptyResult)).toBe(true);
    expect((await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('ready');
    expect((await repository.get(procedureId)).version).toBe(board.version);
  });
  it('keeps disabled-client retries at thirty seconds without consuming attempts', async () => {
    const { board } = await placementJob();
    const format = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    for (let retry = 0; retry < 7; retry++) {
      const running = await claim(format.proposalId);
      expect(running.job.attempts).toBe(1);
      await repository.deferAi(format.proposalId, running.token, 'PROCEDURE_BOARD_CLIENT_DISABLED');
      const deferred = await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: format.proposalId } });
      expect(deferred.state).toBe('deferred');
      expect(deferred.attempts).toBe(0);
      expect(deferred.retryAt.getTime() - now.getTime()).toBe(30000);
      now = deferred.retryAt;
    }
    const enabled = await claim(format.proposalId);
    expect(await repository.saveAiResult(format.proposalId, enabled.token, board.version, formatOf(board.layout))).toBe(true);
  });
  it('replays concurrent format requests and returns conflicts for reused event ids', async () => {
    const { board } = await placementJob();
    const requestId = randomUUID();
    const requests = await Promise.all([1, 2].map(() => repository.enqueueAi(procedureId, 'client-1', 'format', requestId, board.version)));
    expect(requests[0].proposalId).toBe(requests[1].proposalId);
    expect(await db.knowledgeProcedureBoardEvent.count({ where: { id: requestId } })).toBe(1);
    const other = await repository.getOrCreate(otherId, 'client-1');
    await expect(repository.enqueueAi(otherId, 'client-1', 'format', requestId, other.version)).rejects.toMatchObject({ statusCode: 409 });
    expect(await db.knowledgeProcedureBoardAi.count({ where: { boardId: other.boardId, kind: 'format', requestKey: requestId } })).toBe(0);
    const eventId = randomUUID();
    await repository.appendEvents(procedureId, 'client-1', board.version, [{ id: eventId, type: 'material_work',
      payload: { materialId, workId: randomUUID(), activeMs: 1000 } }]);
    await expect(repository.enqueueAi(procedureId, 'client-1', 'format', eventId, board.version)).rejects.toMatchObject({ statusCode: 409 });
    // A cross-board race can pass both prechecks; P2002 must still resolve to 409.
    const racingId = randomUUID();
    const race = await Promise.allSettled([
      repository.enqueueAi(procedureId, 'client-1', 'format', racingId, board.version),
      repository.enqueueAi(otherId, 'client-1', 'format', racingId, other.version),
    ]);
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
  });
  it('saves while AI is unavailable, marks old results stale, and rejects stale acceptance', async () => {
    const { board } = await placementJob();
    // Make a new format job so a placement job already completed by the previous test stays final.
    const format = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    const secondFormat = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    const running = await claim(format.proposalId);
    const revisions = await db.knowledgeProcedureRevision.findMany({ where: { procedureId } });
    const sourceBefore = (await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source;
    const layout = structuredClone(board.layout); const currentItem = layout.pages[0].rows[0].cols[0].items[0];
    if (currentItem.kind === 'material') currentItem.override = 'AI待機中でも保存できる';
    const saved = await repository.save(procedureId, 'client-1', board.version, layout, { id: randomUUID(), type: 'text_edited', payload: { itemId: item.itemId, materialId } });
    expect(saved.version).toBe(board.version + 1);
    expect(await repository.saveAiResult(format.proposalId, running.token, board.version, formatOf(board.layout))).toBe(true);
    expect((await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: format.proposalId } })).state).toBe('stale');
    await expect(repository.decideFormat(procedureId, 'client-1', format.proposalId, { expectedVersion: board.version, eventId: randomUUID(), action: 'accept' })).rejects.toMatchObject({ statusCode: 409, code: 'PROCEDURE_BOARD_SUGGESTION_STALE' });
    for (const expectedVersion of [board.version, saved.version]) {
      await expect(repository.decideFormat(procedureId, 'client-1', format.proposalId, { expectedVersion, eventId: randomUUID(), action: 'accept' })).rejects.toMatchObject({ statusCode: 409 });
    }
    await expect(repository.decideFormat(procedureId, 'client-1', secondFormat.proposalId, { expectedVersion: saved.version + 1, eventId: randomUUID(), action: 'revert' })).rejects.toMatchObject({ statusCode: 409 });
    const currentRevert = await repository.decideFormat(procedureId, 'client-1', secondFormat.proposalId, { expectedVersion: saved.version, eventId: randomUUID(), action: 'revert' });
    expect(currentRevert.version).toBe(saved.version); expect(currentRevert.layout).toEqual(saved.layout);
    const reverted = await repository.decideFormat(procedureId, 'client-1', format.proposalId, { expectedVersion: board.version, eventId: randomUUID(), action: 'revert' });
    expect(reverted.version).toBe(saved.version); expect(reverted.layout).toEqual(saved.layout);
    expect((await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source).toEqual(sourceBefore);
    expect(await db.knowledgeProcedureRevision.findMany({ where: { procedureId } })).toEqual(revisions);
  });
  it('compares source fingerprints on completion and claim, retaining overrides', async () => {
    const { board, job } = await placementJob(); const running = await claim(job.id);
    await db.knowledgeProcedureMaterial.update({ where: { id: materialId }, data: { source: { ...source, text: '原文の追加変更' } } });
    expect(await repository.saveAiResult(job.id, running.token, board.version, emptyResult)).toBe(true);
    const refreshed = await repository.get(procedureId);
    expect(refreshed.version).toBe(board.version + 1); expect(refreshed.layout).toEqual(board.layout);
    expect((await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('stale');
    const next = await placementJob();
    await db.knowledgeProcedureMaterial.update({ where: { id: materialId }, data: { source: { ...source, text: 'claim直前の変更' } } });
    await db.knowledgeProcedureBoardAi.update({ where: { id: next.job.id }, data: { retryAt: new Date(0) } });
    expect(await repository.claimAi(randomUUID())).toBeNull();
    expect((await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: next.job.id } })).state).toBe('stale');
  });
  it('does not automatically retry failed inputs and uses a new explicit request for format', async () => {
    const { board } = await placementJob(); const requestId = randomUUID();
    const format = await repository.enqueueAi(procedureId, 'client-1', 'format', requestId, board.version);
    const running = await claim(format.proposalId);
    await repository.deferAi(format.proposalId, running.token, 'PROCEDURE_BOARD_AI_FAILED', false);
    expect((await repository.enqueueAi(procedureId, 'client-1', 'format', requestId, board.version)).proposalId).toBe(format.proposalId);
    const retry = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    expect(retry.proposalId).not.toBe(format.proposalId);
    expect((await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: format.proposalId } })).state).toBe('failed');
    const runningRetry = await claim(retry.proposalId);
    expect(runningRetry.job.attempts).toBe(1);
    await repository.deferAi(retry.proposalId, runningRetry.token, 'WAITING_FOR_INFERENCE');
    const deferred = await db.knowledgeProcedureBoardAi.findUniqueOrThrow({ where: { id: retry.proposalId } });
    expect(deferred.retryAt.getTime() - now.getTime()).toBe(30000);
  });
  it('reverts without changing version/layout, accepts atomically, and replays once', async () => {
    const { board } = await placementJob();
    const format = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    const running = await claim(format.proposalId);
    const formatted = formatOf(board.layout);
    const itemId = board.layout.pages[0].rows[0].cols[0].items[0].itemId;
    const result = { ...formatted, styles: [{ itemId, style: 'caution' }] };
    await repository.saveAiResult(format.proposalId, running.token, board.version, result);
    const revertEvent = { expectedVersion: board.version, eventId: randomUUID(), action: 'revert' as const };
    const reverted = await repository.decideFormat(procedureId, 'client-1', format.proposalId, revertEvent);
    expect(reverted.version).toBe(board.version); expect(reverted.layout).toEqual(board.layout);
    expect((await repository.decideFormat(procedureId, 'client-1', format.proposalId, revertEvent)).version).toBe(board.version);
    const next = await repository.enqueueAi(procedureId, 'client-1', 'format', randomUUID(), board.version);
    const claimed = await claim(next.proposalId);
    await repository.saveAiResult(next.proposalId, claimed.token, board.version, result);
    const accept = { expectedVersion: board.version, eventId: randomUUID(), action: 'accept' as const };
    const accepted = await repository.decideFormat(procedureId, 'client-1', next.proposalId, accept);
    expect(accepted.version).toBe(board.version + 1); expect(accepted.state).toBe('accepted');
    expect(accepted.layout.pages[0].rows[0].cols[0].items[0]).toEqual({ ...board.layout.pages[0].rows[0].cols[0].items[0], style: 'caution' });
    expect((await repository.decideFormat(procedureId, 'client-1', next.proposalId, accept)).version).toBe(accepted.version);
    expect(await db.knowledgeProcedureBoardAi.count({ where: { boardId: board.boardId, kind: 'placement', boardVersion: accepted.version } })).toBe(1);
    const sourceBefore = (await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source;
    expect(await db.knowledgeProcedureRevision.count({ where: { procedureId } })).toBe(1);
    expect((await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source).toEqual(sourceBefore);
  });
  it('persists human conflict decisions without changing source or resolving a conflict automatically', async () => {
    const secondId = randomUUID();
    try {
      await db.knowledgeProcedureMaterial.create({ data: { id: secondId, intakeId: 'board-local-test', sourceId: randomUUID(), procedureId, state: 'assigned', organized: {}, source: { ...source, id: randomUUID(), text: '別の原文' } } });
      const current = await placementJob(); const running = await claim(current.job.id);
      const original = (await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source as { text: string };
      const conflict = { id: 'c1', materialIds: [materialId, secondId], quotes: [original.text, '別の原文'] };
      await repository.saveAiResult(current.job.id, running.token, current.board.version, { ...emptyResult, conflicts: [conflict] });
      expect((await repository.get(procedureId)).decisions.conflicts).toEqual([]);
      const selected = await repository.decidePlacement(procedureId, 'client-1', current.job.id, { expectedVersion: current.board.version, eventId: randomUUID(), proposalId: 'c1', action: 'select_conflict', selectedMaterialId: null });
      expect(selected.decisions.conflicts).toEqual([{ materialIds: [materialId, secondId], selectedMaterialId: null }]);
      expect(selected.layout).toEqual(current.board.layout);
      expect((await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: materialId } })).source).toEqual(original);
    } finally { await db.knowledgeProcedureMaterial.deleteMany({ where: { id: secondId } }); }
  });
  it('accepts, dismisses and relocates placements, persists headings, and deduplicates decisions', async () => {
    const extraId = randomUUID(); const originalBoard = await repository.get(procedureId);
    try {
      await db.knowledgeProcedureMaterial.create({ data: { id: extraId, intakeId: 'board-local-test', sourceId: randomUUID(), procedureId, state: 'assigned', organized: {}, source: { ...source, id: randomUUID(), text: '準備を確認する' } } });
      const current = await placementJob(); const running = await claim(current.job.id);
      const proposal = { id: 'p1', materialId: extraId, page: 1, row: current.board.layout.pages[0].rows.length, col: 0, index: 0, mode: 'row' };
      await repository.saveAiResult(current.job.id, running.token, current.board.version, { ...emptyResult, placements: [proposal] });
      const accept = { expectedVersion: current.board.version, eventId: randomUUID(), proposalId: 'p1', action: 'accept' as const, itemId: randomUUID() };
      await expect(repository.decidePlacement(procedureId, 'client-1', current.job.id, accept)).rejects.toMatchObject({ statusCode: 400 });
      await repository.appendEvents(procedureId, 'client-1', current.board.version, [{ id: randomUUID(), type: 'placement_shown', payload: { suggestionSetId: current.job.id, proposalId: 'p1', materialId: extraId } }]);
      const accepted = await repository.decidePlacement(procedureId, 'client-1', current.job.id, accept);
      expect(accepted.version).toBe(current.board.version + 1);
      expect(accepted.layout.pages[0].rows.at(-1)!.cols[0].items[0]).toEqual({ itemId: accept.itemId, materialId: extraId, kind: 'material', origin: 'ai-accepted', style: 'body' });
      expect((await repository.decidePlacement(procedureId, 'client-1', current.job.id, accept)).version).toBe(accepted.version);
      await expect(repository.decidePlacement(procedureId, 'client-1', current.job.id, { ...accept, eventId: randomUUID() })).rejects.toMatchObject({ statusCode: 409, code: 'PROCEDURE_BOARD_SUGGESTION_STALE' });
      await repository.save(procedureId, 'client-1', accepted.version, current.board.layout, { id: randomUUID(), type: 'item_removed', payload: { itemId: accept.itemId, materialId: extraId } });
      const dismissJob = await placementJob(); const dismissRun = await claim(dismissJob.job.id);
      await repository.saveAiResult(dismissJob.job.id, dismissRun.token, dismissJob.board.version, { ...emptyResult, placements: [proposal] });
      const dismissed = await repository.decidePlacement(procedureId, 'client-1', dismissJob.job.id, { expectedVersion: dismissJob.board.version, eventId: randomUUID(), proposalId: 'p1', action: 'dismiss' });
      expect(dismissed.layout).toEqual(dismissJob.board.layout); expect(dismissed.decisions.dismissedPlacements).toHaveLength(1);
      const suppressed = await placementJob(); const suppressedRun = await claim(suppressed.job.id);
      await repository.saveAiResult(suppressed.job.id, suppressedRun.token, suppressed.board.version, { ...emptyResult, placements: [proposal], headings: [{ id: 'h1', page: 2, text: '準備' }] });
      expect((await repository.suggestions(procedureId, 'client-1')).current?.placements).toEqual([]);
      const headed = await repository.decidePlacement(procedureId, 'client-1', suppressed.job.id, { expectedVersion: suppressed.board.version, eventId: randomUUID(), proposalId: 'h1', action: 'accept' });
      expect(headed.layout.pages[1].heading).toBe('準備');
      const manualItem = { itemId: randomUUID(), kind: 'material' as const, materialId: extraId, origin: 'human' as const, style: 'body' as const };
      const manual = await repository.save(procedureId, 'client-1', headed.version, placeItem(headed.layout, manualItem, { page: 2, row: 0, col: 0, index: 0, mode: 'row' }), { id: randomUUID(), type: 'material_placed', payload: { itemId: manualItem.itemId, materialId: extraId, to: { page: 2, row: 0, col: 0, index: 0 } } });
      await repository.save(procedureId, 'client-1', manual.version, headed.layout, { id: randomUUID(), type: 'item_removed', payload: { itemId: manualItem.itemId, materialId: extraId } });
      await db.knowledgeProcedureMaterial.update({ where: { id: extraId }, data: { source: { ...source, text: '準備を再確認する' } } });
      const relocate = await placementJob(); const relocateRun = await claim(relocate.job.id);
      await repository.saveAiResult(relocate.job.id, relocateRun.token, relocate.board.version, { ...emptyResult, placements: [proposal] });
      const moved = await repository.decidePlacement(procedureId, 'client-1', relocate.job.id, { expectedVersion: relocate.board.version, eventId: randomUUID(), proposalId: 'p1', action: 'relocate', itemId: randomUUID(), target: { page: 2, row: 0, col: 0, index: 0, mode: 'row' } });
      expect(moved.layout.pages[1].rows[0].cols[0].items[0]).toMatchObject({ materialId: extraId });
      expect((await db.knowledgeProcedureMaterial.findUniqueOrThrow({ where: { id: extraId } })).source).toEqual({ ...source, text: '準備を再確認する' });
    } finally {
      await db.knowledgeProcedureBoard.update({ where: { id: originalBoard.boardId }, data: { layout: originalBoard.layout, version: { increment: 1 } } });
      await db.knowledgeProcedureMaterial.deleteMany({ where: { id: extraId } });
    }
  });
  it('keeps removed material references editable/removable but refuses new references and does not expose their content', async () => {
    const board = await repository.get(procedureId);
    await db.knowledgeProcedureMaterial.update({ where: { id: materialId }, data: { procedureId: otherId } });
    const refreshed = await repository.get(procedureId);
    expect(refreshed.layout).toEqual(board.layout);
    expect((await repository.materials(procedureId, undefined, 100)).materials).toEqual([]);
    const duplicated = structuredClone(refreshed.layout);
    duplicated.pages[0].rows.push({ cols: [{ items: [{ ...item, itemId: randomUUID() }] }], w: [1] });
    const duplicateId = duplicated.pages[0].rows.at(-1)!.cols[0].items[0].itemId;
    await expect(repository.save(procedureId, 'client-1', refreshed.version, duplicated, { id: randomUUID(), type: 'item_duplicated', payload: { itemId: duplicateId, sourceItemId: item.itemId } })).rejects.toMatchObject({ statusCode: 400 });
    expect((await repository.save(procedureId, 'client-1', refreshed.version, emptyLayout(), { id: randomUUID(), type: 'item_removed', payload: { itemId: item.itemId, materialId } })).layout).toEqual(emptyLayout());
    await db.knowledgeProcedureMaterial.update({ where: { id: materialId }, data: { procedureId } });
  });

});
