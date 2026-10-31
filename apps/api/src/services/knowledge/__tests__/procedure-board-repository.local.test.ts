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
});
