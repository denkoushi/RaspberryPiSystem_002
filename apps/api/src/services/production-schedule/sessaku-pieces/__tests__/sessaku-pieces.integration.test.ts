import { buildOrderSupplementKey, buildReplacementCreateInputs, runOrderSupplementReplacementTransaction, toSupplementNormalizedRow } from '../../order-supplement-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from '../../external-completion/fkojunst-external-completion-sync.repository.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../../fkojunst-status-mail-critical-lock.js';
import { getGrindingPlanningBoardDueScope, updateGrindingPlanningBoardDueScope } from '../../grinding-planning-board-due-scope.service.js';
import { readPlanningSnapshotGenerationToken } from '../../grinding-planning-board/state.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import { createPrismaClient } from '../../../../lib/prisma-client.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../constants.js';
import { getGrindingPlanningBoard, updateGrindingPlanningBoardArrival, updateGrindingPlanningBoardRank, updateGrindingPlanningBoardResourceOrder } from '../../grinding-planning-board.service.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../../leaderboard/leaderboard-shell-snapshot.store.js';
import { splitSessakuPieces, mergeSessakuPieces, setSessakuPieceCompletion } from '../sessaku-pieces.service.js';
import { encodeSessakuPieceKey, acquireSessakuPieceLogicalLocks, sessakuPieceKeyFromRow, readSessakuPieceSet, findSessakuPieceWinner } from '../piece-key.js';
import { reconcileSessakuPieceQuantities } from '../piece-quantity.js';
import { reconcileSessakuPieceProgress } from '../piece-completion.js';
import { publishSessakuPieceProgress, readSessakuPiecePublicationState, synchronizeSessakuPieceSources } from '../piece-sync.js';
import { setProductionScheduleRowCompletionIntent } from '../../production-schedule-command.service.js';
import { ProgressSyncFromCsvService } from '../../progress-sync-from-csv.service.js';
import { readGrindingPlanningBoardLoadSummary } from '../../grinding-planning-board-load-summary.js';
import { enrichRowsWithProcessArrival } from '../../process-arrival.service.js';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const url = process.env.TEST_DATABASE_URL;
const hasDedicatedDatabase = Boolean(url) && !['/borrow_return', '/postgres', '/template1'].includes(new URL(url!).pathname);
const describeDatabase = hasDedicatedDatabase ? describe : describe.skip;
const reader = createPrismaClient(url ?? 'postgresql://disabled.invalid/disabled');
let site: string, other: string, seiban: string, rowId: string, nextRowId: string;
let rowData: Record<string, string>;
const store = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60000 });
const key = () => sessakuPieceKeyFromRow(rowData);
const board = (pieces = true, targetSite = site, filter: 'all' | 'incomplete' = 'all') => getGrindingPlanningBoard({ siteKey: targetSite, category: 'cutting', view: 'resource', includePieces: pieces, includeLoad: false, completionFilter: filter, snapshotStore: store });
const parent = async () => (await board(false)).items.find((i) => i.sourceRowId === rowId)!;
const split = async () => { const p = await parent(); return splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [2, 3] }); };
const complete = (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete' = 'complete', targetSite = site) => setSessakuPieceCompletion({ siteKey: targetSite, pieceId: item.pieceId!, expectedPieceSetVersion: item.pieceSetVersion!, itemRevision: item.itemRevision, intent });
async function quantity(total: number | null) {
  await reader.$transaction(async (tx) => {
    await acquireSessakuPieceLogicalLocks(tx, [key()]);
    await tx.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: rowId }, data: { plannedQuantity: total } });
    await reconcileSessakuPieceQuantities(tx, key(), total);
    await reconcileSessakuPieceProgress(tx, key(), { emptyIsIncomplete: true });
  });
}
async function external(value: boolean) {
  await reader.$transaction(async (tx) => {
    await acquireSessakuPieceLogicalLocks(tx, [key()]);
    await tx.productionScheduleExternalCompletion.upsert({ where: { csvDashboardRowId: rowId }, create: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, isExternallyCompleted: value }, update: { isExternallyCompleted: value } });
    await synchronizeSessakuPieceSources(tx, [key()], new Set([encodeSessakuPieceKey(key())]));
  });
}
describeDatabase('sessaku pieces persistence and concurrency', () => {
  beforeEach(async () => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    site = `sessaku-${randomUUID()}`; other = `${site}-other`; seiban = `SS${randomUUID().slice(0, 8)}`;
    await prisma.csvDashboard.upsert({ where: { id: dashboardId }, create: { id: dashboardId, name: 'sessaku', columnDefinitions: [], templateConfig: {} }, update: {} });
    rowData = { FSEIBAN: seiban, FHINCD: 'PART-A', FSIGENCD: '1', FKOJUN: '1', ProductNo: '123', FSIGENSHOYORYO: '100' };
    const row = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData, occurredAt: new Date(), dataHash: site } }); rowId = row.id;
    nextRowId = (await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '2', FSIGENCD: '2' }, occurredAt: new Date(), dataHash: `${site}-next` } })).id;
    await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: '1', plannedQuantity: 5 } });
    await prisma.productionScheduleGrindingPlanningBoardState.createMany({ data: [site, other].map((siteKey) => ({ csvDashboardId: dashboardId, siteKey, seibanOrder: [seiban] })) });
  });
  afterEach(async () => {
    await prisma.productionScheduleSessakuPiece.deleteMany({ where: { pieceSet: { csvDashboardId: dashboardId, fseiban: seiban }, sourcePieceId: { not: null } } });
    await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: dashboardId, dataHash: { startsWith: site } } });
    await prisma.dueManagementOutcomeEvent.deleteMany({ where: { fseiban: seiban } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await reader.$disconnect(); await prisma.$disconnect(); });
  it('gate OFF rejects creation while parent response stays unchanged', async () => {
    const before = await board(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'false');
    await expect(split()).rejects.toMatchObject({ statusCode: 403 });
    expect((await board()).items).toEqual(before.items);
    expect(await readSessakuPieceSet(prisma, key())).toBeNull();
  });
  it('projects [2,3], preserves parent responses, aggregates completion and downstream arrival', async () => {
    let result = await split(); expect(result.pieces.map((p) => p.quantity)).toEqual([2, 3]);
    expect((await board(false)).items.filter((p) => p.sourceRowId === rowId)).toHaveLength(1);
    result = await complete(result.pieces[0]); expect(result.parentIsCompleted).toBe(false);
    const arrival = () => enrichRowsWithProcessArrival([{ id: nextRowId, sourceRowId: nextRowId, rowData: { ...rowData, FKOJUN: '2' } }], { siteKey: site, locationKey: site });
    expect((await arrival())[0].arrived).toBe(false);
    const params = { client: prisma, siteKey: site, category: 'cutting' as const, isResourceInCategory: () => true };
    const fallback = await readGrindingPlanningBoardLoadSummary({ ...params, winnerRowIds: [rowId] });
    const sql = await readGrindingPlanningBoardLoadSummary({ ...params, leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ${rowId}` });
    expect(sql).toEqual(fallback); expect(sql.load[0].requiredMinutes).toBe(60);
    result = await complete(result.pieces[1]); expect(result.parentIsCompleted).toBe(true); expect((await arrival())[0].arrived).toBe(true);
    result = await complete(result.pieces[1], 'incomplete'); expect(result.parentIsCompleted).toBe(false);
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' });
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((p) => !p.isCompleted)).toBe(true);
  });
  it('gate OFF allows completion, merge, tombstones reject ancient first split', async () => {
    const old = await parent(); let r = await split(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'false');
    r = await complete(r.pieces[0]); r = await complete(r.pieces[0], 'incomplete');
    const merged = await mergeSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, expectedPieceSetVersion: r.pieceSetVersion, pieceIds: r.pieces.map((p) => p.pieceId!), itemRevisions: Object.fromEntries(r.pieces.map((p) => [p.itemId, p.itemRevision])) });
    expect(merged.pieces).toEqual([]); expect(merged.parentIsCompleted).toBe(false);
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    await expect(splitSessakuPieces({ siteKey: site, parentItemId: old.itemId, itemRevision: old.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] })).rejects.toMatchObject({ code: 'STALE_SESSAKU_PIECES' });
    expect((await split()).pieceSetVersion).toBeGreaterThan(merged.pieceSetVersion);
  });
  it('rejects legacy writes and shares manual arrival at the parent', async () => {
    const old = await parent(); const r = await split(); const b = await board();
    await expect(updateGrindingPlanningBoardRank({ siteKey: site, sourceRevision: b.sourceRevision, itemId: old.itemId, itemRevision: old.itemRevision, alternateRank: 1 })).rejects.toMatchObject({ code: 'PIECES_REQUIRE_PIECE_TARGET' });
    await updateGrindingPlanningBoardArrival({ siteKey: site, itemId: r.pieces[0].itemId, itemRevision: r.pieces[0].itemRevision, recorded: true });
    const after = await board(); expect(after.items.filter((i) => i.kind === 'piece' && i.sourceRowId === rowId).every((i) => i.manualArrivalDate != null)).toBe(true);
    expect((await prisma.productionScheduleGrindingPlanningBoardArrival.findMany({ where: { siteKey: site } }))[0].itemKey).toBe(r.parentItemId);
  });
  it('resplits and partially merges only unfinished pieces', async () => {
    let r = await split(); r = await complete(r.pieces[0]);
    await expect(splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: r.pieces[0].pieceId, itemRevision: r.pieces[0].itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 1] })).rejects.toMatchObject({ code: 'COMPLETED_PIECE' });
    r = await splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: r.pieces[1].pieceId, itemRevision: r.pieces[1].itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 2] });
    expect(r.pieces.map((p) => p.quantity)).toEqual([2, 1, 2]);
    const unfinished = r.pieces.filter((p) => !p.isCompleted);
    r = await mergeSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, expectedPieceSetVersion: r.pieceSetVersion, pieceIds: unfinished.map((p) => p.pieceId!), itemRevisions: Object.fromEntries(unfinished.map((p) => [p.itemId, p.itemRevision])) });
    expect(r.pieces.map((p) => p.quantity)).toEqual([2, 3]); expect(r.pieces[0].isCompleted).toBe(true);
  });
  it('merges non-adjacent first and third pieces at the first position, preserving the middle', async () => {
    const p = await parent();
    const r = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [1, 2, 2] });
    const selected = [r.pieces[0], r.pieces[2]];
    const merged = await mergeSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, expectedPieceSetVersion: r.pieceSetVersion,
      pieceIds: selected.map((piece) => piece.pieceId!), itemRevisions: Object.fromEntries(selected.map((piece) => [piece.itemId, piece.itemRevision])) });
    expect(merged.pieces.map((piece) => piece.quantity)).toEqual([3, 2]);
    expect(merged.pieces[1].pieceId).toBe(r.pieces[1].pieceId);
    const stored = await readSessakuPieceSet(prisma, key());
    expect(stored?.pieces.map((piece) => [piece.position, piece.quantity])).toEqual([[1, 3], [2, 2]]);
    expect(stored?.pieces[1].id).toBe(r.pieces[1].pieceId);
  });
  it('re-splits a middle target into three pieces and renumbers surviving positions in order', async () => {
    await quantity(12); const p = await parent();
    const r = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [2, 7, 3] });
    const target = r.pieces[1];
    const splitAgain = await splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: target.pieceId,
      itemRevision: target.itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 2, 4] });
    expect(splitAgain.pieces.map((piece) => piece.quantity)).toEqual([2, 1, 2, 4, 3]);
    expect(splitAgain.pieces[0].pieceId).toBe(r.pieces[0].pieceId);
    expect(splitAgain.pieces[4].pieceId).toBe(r.pieces[2].pieceId);
    const stored = await readSessakuPieceSet(prisma, key());
    expect(stored?.pieces.map((piece) => piece.position)).toEqual([1, 2, 3, 4, 5]);
    expect(stored?.pieces.map((piece) => piece.id)).toEqual(splitAgain.pieces.map((piece) => piece.pieceId));
    expect(stored?.pieces.some((piece) => piece.id === target.pieceId)).toBe(false);
    expect(stored?.nextPosition).toBe(6);
  });
  it('quantity sync, warnings, external correction and CSV progress protect manual evidence', async () => {
    let r = await split(); r = await complete(r.pieces[0]);
    for (const [total, quantities] of [[7, [2, 5]], [4, [2, 2]]] as const) { await quantity(total); expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.quantity)).toEqual(quantities); }
    await quantity(1); expect((await board(true, site, 'incomplete')).items.find((i) => i.kind === 'piece' && i.sourceRowId === rowId)?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
    await quantity(5); await external(true); await quantity(4);
    const warned = (await board(true, site, 'incomplete')).items.filter((i) => i.kind === 'piece' && i.sourceRowId === rowId); expect(warned).toHaveLength(2); expect(warned.every((i) => i.isCompleted && i.quantityWarning)).toBe(true);
    await expect(complete(warned[0], 'incomplete')).rejects.toMatchObject({ code: 'EXTERNALLY_COMPLETED_ITEM' });
    await external(false); expect((await readSessakuPieceSet(prisma, key()))).toMatchObject({ quantityWarning: null, pieces: [{ quantity: 2, isCompleted: true }, { quantity: 2, isCompleted: false }] });
    await new ProgressSyncFromCsvService().sync({ candidates: [{ rowId, rowData: { ...rowData, progress: '完了' }, occurredAt: new Date('2099-01-01') }] });
    expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).isCompleted).toBe(false);
    await quantity(2); expect((await readSessakuPieceSet(prisma, key()))?.pieces).toHaveLength(1);
    await quantity(5); expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.quantity)).toEqual([2, 3]);
  });
  it('two concurrent first splits and two different piece completions reject the stale request', async () => {
    const p = await parent(); const input = { siteKey: site, parentItemId: p.itemId, expectedPieceSetVersion: 0, itemRevision: p.itemRevision, quantities: [2, 3] };
    const created = await Promise.allSettled([splitSessakuPieces(input), splitSessakuPieces(input)]);
    expect(created.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(created.find((r) => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    const r = created.find((r) => r.status === 'fulfilled')!; if (r.status !== 'fulfilled') throw new Error();
    const completed = await Promise.allSettled(r.value.pieces.map((p) => complete(p)));
    expect(completed.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(completed.find((r) => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
  });
  it('two connections serialize split against quantity synchronization', async () => {
    const p = await parent(); let release!: () => void; let locked!: () => void;
    const barrier = new Promise<void>((r) => { locked = r; }); const unlock = new Promise<void>((r) => { release = r; });
    const pending = reader.$transaction(async (tx) => { await acquireSessakuPieceLogicalLocks(tx, [key()]); locked(); await unlock; await tx.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: rowId }, data: { plannedQuantity: 7 } }); });
    await barrier;
    const splitPending = splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, expectedPieceSetVersion: 0, itemRevision: p.itemRevision, quantities: [2, 3] }); release(); await pending;
    await expect(splitPending).rejects.toMatchObject({ code: 'STALE_SESSAKU_PIECES' }); expect(await readSessakuPieceSet(prisma, key())).toBeNull();
  });
  it('publishes winner replacement and restored Progress atomically on two connections', async () => {
    let r = await split(); r = await complete(r.pieces[0]); r = await complete(r.pieces[1]);
    const oldIds = r.pieces.map((p) => p.pieceId); let release!: () => void; let ready!: () => void;
    const barrier = new Promise<void>((r) => { ready = r; }); const unlock = new Promise<void>((r) => { release = r; });
    let newRow = '';
    const publish = reader.$transaction(async (tx) => {
      await acquireSessakuPieceLogicalLocks(tx, [key()]); const states = await readSessakuPiecePublicationState(tx, [key()]);
      newRow = (await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, ProductNo: '999' }, dataHash: `${site}-new`, occurredAt: new Date() } })).id;
      await publishSessakuPieceProgress(tx, states); ready(); await unlock;
    });
    await barrier;
    expect((await findSessakuPieceWinner(prisma, key()))?.id).toBe(rowId); expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).isCompleted).toBe(true);
    release(); await publish;
    expect((await findSessakuPieceWinner(prisma, key()))?.id).toBe(newRow); expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: newRow } })).isCompleted).toBe(true);
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.id)).toEqual(oldIds);
  });
  it('site-specific ordering does not change the shared piece-set version', async () => {
    const r = await split(); const otherBefore = (await board(true, other)).items.filter((i) => i.kind === 'piece' && i.sourceRowId === rowId); const b = await board();
    await updateGrindingPlanningBoardResourceOrder({ siteKey: site, sourceRevision: b.sourceRevision, itemId: r.pieces[1].itemId, itemRevision: r.pieces[1].itemRevision, targetItemId: r.pieces[0].itemId, targetItemRevision: r.pieces[0].itemRevision, placement: 'before' });
    expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(r.pieceSetVersion);
    expect((await board(true, other)).items.filter((i) => i.kind === 'piece' && i.sourceRowId === rowId).map((i) => i.itemId)).toEqual(otherBefore.map((i) => i.itemId));
  });
  it('synchronizes actual supplement input 0 and invalid values without changing the legacy parser', async () => {
    await split();
    const apply = async (raw: string) => {
      const source = toSupplementNormalizedRow('source', { ProductNo: '123', FSIGENCD: '1', FKOJUN: '1', plannedQuantity: raw })!;
      const supplement = await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } });
      const lookup = buildOrderSupplementKey(source);
      const plan = buildReplacementCreateInputs([source], new Map([[lookup, rowId]]), new Map([[lookup, supplement]]), new Date());
      return runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: 1, normalized: 1 });
    };
    await apply(''); expect((await readSessakuPieceSet(prisma, key()))?.quantityWarning).toBe('INVALID_PLANNED_QUANTITY');
    await apply('-1'); expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.quantity)).toEqual([2, 3]);
    await apply('5'); const stable = await readSessakuPieceSet(prisma, key());
    await apply('5'); expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(stable?.version);
    await apply('0'); expect((await readSessakuPieceSet(prisma, key()))).toMatchObject({ plannedQuantity: 0, pieces: [], quantityWarning: null });
    await apply('7'); expect((await readSessakuPieceSet(prisma, key()))).toMatchObject({ plannedQuantity: 0, pieces: [], quantityWarning: null });
    expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).plannedQuantity).toBe(7);
    await apply('');
    expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).plannedQuantity).toBe(7);
    expect((await readSessakuPieceSet(prisma, key()))?.quantityWarning).toBeNull();
    expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).isCompleted).toBe(false);
  });
  it('external C publication and its correction preserve manual values and are idempotent', async () => {
    let r = await split(); r = await complete(r.pieces[0]);
    const mail = await prisma.productionScheduleFkojunstMailStatus.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, sourceCsvDashboardId: site, fkojun: '1', fkoteicd: '1', fsezono: '123', statusCode: 'C', sourceUpdatedAt: new Date() } });
    const sync = () => reader.$transaction(async (tx) => { await acquireFkojunstStatusMailCriticalTransactionLock(tx); await replaceAllWinnerExternalCompletionStatesFromMailSync(tx); });
    await sync(); const version = (await readSessakuPieceSet(prisma, key()))?.version;
    await sync(); expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(version);
    let items = (await board()).items.filter((p) => p.kind === 'piece' && p.sourceRowId === rowId); await complete(items[1]);
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.isCompleted)).toEqual([true, false]);
    await prisma.productionScheduleFkojunstMailStatus.update({ where: { id: mail.id }, data: { statusCode: 'S' } }); await sync();
    items = (await board()).items.filter((p) => p.kind === 'piece' && p.sourceRowId === rowId); expect(items.map((p) => p.isCompleted)).toEqual([true, false]);
  });
  it('same-order winner replacement moves source records in the same publication transaction', async () => {
    await split(); await external(true);
    await prisma.productionScheduleFkojunstMailStatus.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, sourceCsvDashboardId: site, fkojun: '1', fkoteicd: '1', fsezono: '123', statusCode: 'C', sourceUpdatedAt: new Date() } });
    let replacement = '';
    await reader.$transaction(async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx); await acquireSessakuPieceLogicalLocks(tx, [key()]);
      const before = await readSessakuPiecePublicationState(tx, [key()]);
      replacement = (await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData, dataHash: `${site}-replacement`, occurredAt: new Date(), createdAt: new Date(Date.now() + 1000) } })).id;
      await publishSessakuPieceProgress(tx, before);
    });
    expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: replacement } })).plannedQuantity).toBe(5);
    await reader.$transaction(async (tx) => { await acquireFkojunstStatusMailCriticalTransactionLock(tx); await replaceAllWinnerExternalCompletionStatesFromMailSync(tx); });
    expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: replacement } })).isCompleted).toBe(true);
  });
  it('invalidates reusable payloads for both sites and separates parent and piece cursor scopes', async () => {
    await split(); const initial = await board(true, other); const parentResponse = await board(false);
    await expect(getGrindingPlanningBoard({ siteKey: site, category: 'cutting', view: 'resource', includePieces: true, includeLoad: false, snapshotId: parentResponse.snapshotId, cursor: 1, snapshotStore: store })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    const before = await readPlanningSnapshotGenerationToken(other); const item = (await board()).items.find((p) => p.kind === 'piece' && p.sourceRowId === rowId)!; await complete(item);
    expect(await readPlanningSnapshotGenerationToken(other)).not.toBe(before);
    const after = await board(true, other); expect(after.items.find((p) => p.itemId === item.itemId)?.isCompleted).toBe(true); expect(initial.items.find((p) => p.itemId === item.itemId)?.isCompleted).toBe(false);
  });
  it('serializes cancellation against external C without losing manual evidence', async () => {
    let r = await split(); r = await complete(r.pieces[0]);
    const result = await Promise.allSettled([complete(r.pieces[0], 'incomplete'), external(true)]);
    expect(result.some((entry) => entry.status === 'fulfilled')).toBe(true);
    const set = await readSessakuPieceSet(prisma, key()); expect(set?.pieces.map((p) => p.quantity)).toEqual([2, 3]);
    expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).isCompleted).toBe(true);
  });
  it('serializes ordering against merge and accepts independent site edits', async () => {
    let r = await split(); const b = await board();
    const merge = mergeSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, expectedPieceSetVersion: r.pieceSetVersion, pieceIds: r.pieces.map((p) => p.pieceId!), itemRevisions: Object.fromEntries(r.pieces.map((p) => [p.itemId, p.itemRevision])) });
    const reorder = updateGrindingPlanningBoardResourceOrder({ siteKey: site, sourceRevision: b.sourceRevision, itemId: r.pieces[1].itemId, itemRevision: r.pieces[1].itemRevision, targetItemId: r.pieces[0].itemId, targetItemRevision: r.pieces[0].itemRevision, placement: 'before' });
    const results = await Promise.allSettled([merge, reorder]); expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    if (!(await readSessakuPieceSet(prisma, key()))?.pieces.length) r = await split(); else r.pieces = (await board()).items.filter((p) => p.kind === 'piece' && p.sourceRowId === rowId);
    const one = (await board()).items.find((p) => p.kind === 'piece' && p.sourceRowId === rowId)!; const two = (await board(true, other)).items.find((p) => p.kind === 'piece' && p.sourceRowId === rowId)!;
    const edits = await Promise.allSettled([updateGrindingPlanningBoardRank({ siteKey: site, sourceRevision: (await board()).sourceRevision, itemId: one.itemId, itemRevision: one.itemRevision, alternateRank: 10 }), updateGrindingPlanningBoardRank({ siteKey: other, sourceRevision: (await board(true, other)).sourceRevision, itemId: two.itemId, itemRevision: two.itemRevision, alternateRank: 20 })]);
    expect(edits.every((entry) => entry.status === 'fulfilled')).toBe(true);
  });
  it('expands due-scope updates to all pieces and clears their ranks', async () => {
    const r = await split(); const snapshot = await getGrindingPlanningBoardDueScope({ siteKey: site, deviceScopeKey: site, fseiban: seiban });
    await updateGrindingPlanningBoardDueScope({ siteKey: site, fseiban: seiban, request: { sourceGenerationToken: snapshot.sourceGenerationToken, scopeRevision: snapshot.scopeRevision, scope: { kind: 'seiban' }, dueDate: '2099-01-01' } });
    const items = (await board()).items.filter((p) => p.kind === 'piece' && p.sourceRowId === rowId); expect(items).toHaveLength(r.pieces.length); expect(items.every((p) => p.effectiveDueDate === '2099-01-01' && p.alternateRank === null)).toBe(true);
  });
  it('enforces DB quantity, position, version and completion timestamp constraints', async () => {
    await split(); const set = (await readSessakuPieceSet(prisma, key()))!;
    for (const data of [{ quantity: 0 }, { position: 0 }, { isCompleted: true, completedAt: null }]) await expect(prisma.productionScheduleSessakuPiece.update({ where: { id: set.pieces[0].id }, data })).rejects.toBeDefined();
    await expect(prisma.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { version: 0 } })).rejects.toBeDefined();
  });

  it('keeps decimal processing-minute rounding identical in SQL, fallback and projection', async () => {
    await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData: { ...rowData, FSIGENSHOYORYO: '1.15' } } });
    await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: rowId }, data: { plannedQuantity: 2 } });
    const p = await parent(); const r = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 1] });
    const params = { client: prisma, siteKey: site, category: 'cutting' as const, isResourceInCategory: () => true };
    const sql = await readGrindingPlanningBoardLoadSummary({ ...params, leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ${rowId}` });
    const fallback = await readGrindingPlanningBoardLoadSummary({ ...params, winnerRowIds: [rowId] });
    expect(sql).toEqual(fallback); expect(sql.load[0].requiredMinutes).toBe(r.pieces.reduce((sum, piece) => sum + piece.requiredMinutes!, 0));
  });

  it.each([false, true])('does not expose a tombstone warning or acquire piece/board locks for parent due writes (tombstone=%s)', async (tombstone) => {
    if (tombstone) await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...key(), quantityWarning: 'INVALID_PLANNED_QUANTITY' } });
    expect((await parent()).quantityWarning ?? null).toBeNull();
    const snapshot = await getGrindingPlanningBoardDueScope({ siteKey: site, deviceScopeKey: site, fseiban: seiban });
    const original = prisma.$transaction.bind(prisma);
    const transaction = vi.spyOn(prisma, '$transaction');
    let checked = false;
    transaction.mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => original(async (tx) => {
      const execute = vi.spyOn(tx, '$executeRaw');
      const query = vi.spyOn(tx, '$queryRaw');
      try {
        const result = await callback(tx);
        expect(execute.mock.calls.length).toBeGreaterThan(0); // legacy parent locks still execute
        expect(execute.mock.calls.some((args) => args.some((value) => typeof value === 'string' && value.startsWith('sessaku')))).toBe(false);
        expect(query.mock.calls.some((args) => { const sql = JSON.stringify(args[0]); return sql.includes('ProductionScheduleGrindingPlanningBoardState') && sql.includes('FOR UPDATE'); })).toBe(false);
        checked = true;
        return result;
      } finally { execute.mockRestore(); query.mockRestore(); }
    }, options)) as never);
    try {
      await updateGrindingPlanningBoardDueScope({ siteKey: site, fseiban: seiban, request: { sourceGenerationToken: snapshot.sourceGenerationToken,
        scopeRevision: snapshot.scopeRevision, scope: { kind: 'seiban' }, dueDate: '2099-02-01' } });
      expect(checked).toBe(true);
    } finally { transaction.mockRestore(); }
  });

  it('serializes a first split behind the existing mail critical lock without locking missing piece keys', async () => {
    const p = await parent();
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => { ready = resolve; });
    const unlock = new Promise<void>((resolve) => { release = resolve; });
    const mail = reader.$transaction(async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      ready(); await unlock;
      await tx.productionScheduleFkojunstMailStatus.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId,
        sourceCsvDashboardId: site, fkojun: '1', fkoteicd: '1', fsezono: '123', statusCode: 'C', sourceUpdatedAt: new Date() } });
      await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
    }, { timeout: 30000, maxWait: 15000 });
    await locked;
    const splitPending = splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] });
    const assertion = expect(splitPending).rejects.toMatchObject({ code: 'EXTERNALLY_COMPLETED_ITEM' });
    release(); await mail; await assertion;
    expect(await readSessakuPieceSet(prisma, key())).toBeNull();
  });

  describe('linked later process pieces', () => {
    const laterKey = () => ({ ...key(), fsigencd: '2', fkojun: '2' });
    const allBoard = (targetSite = site) => getGrindingPlanningBoard({ siteKey: targetSite, category: 'all', view: 'resource', includePieces: true, includeLoad: false, snapshotStore: store });
    const laterItems = async () => (await allBoard()).items.filter((item) => item.sourceRowId === nextRowId);
    const splitThree = async () => {
      const p = await parent();
      return splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [1, 2, 2] });
    };
    const merge = (r: Awaited<ReturnType<typeof splitThree>>, selected = r.pieces) => mergeSessakuPieces({
      siteKey: site, parentItemId: r.parentItemId, expectedPieceSetVersion: r.pieceSetVersion,
      pieceIds: selected.map((piece) => piece.pieceId!), itemRevisions: Object.fromEntries(selected.map((piece) => [piece.itemId, piece.itemRevision]))
    });
    beforeEach(async () => {
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 5 } });
    });
    it('creates matching positions, quantities and source links, inheriting each site placement', async () => {
      const laterParent = (await laterItems())[0];
      for (const [index, siteKey] of [site, other].entries()) await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: {
        csvDashboardId: dashboardId, siteKey, itemKey: laterParent.itemId, overrideResourceCd: `GRIND-${index}`, alternateRank: 1, orderPinned: true
      } });
      const r = await splitThree(); const set = await readSessakuPieceSet(prisma, laterKey());
      expect(set?.pieces.map((piece) => [piece.position, piece.quantity, piece.sourcePieceId])).toEqual(r.pieces.map((piece) => [piece.piecePosition, piece.quantity, piece.pieceId]));
      for (const [index, siteKey] of [site, other].entries()) {
        const items = (await allBoard(siteKey)).items.filter((item) => item.sourceRowId === nextRowId);
        expect(items.map((item) => item.effectiveResourceCd)).toEqual(Array(3).fill(`GRIND-${index}`));
        expect(items.map((item) => item.alternateRank)).toEqual([1, 2, 3]);
        expect(items.every((item) => item.sourcePieceId && item.orderPinned)).toBe(true);
        expect(items.map((item) => item.requiredMinutes)).toEqual([20, 40, 40]);
      }
    });
    it('updates a site with only a later override even when the seiban is not registered there', async () => {
      const laterParent = (await laterItems())[0];
      await prisma.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: { csvDashboardId: dashboardId, siteKey: other } }, data: { seibanOrder: [] } });
      await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: other, itemKey: laterParent.itemId, overrideResourceCd: '581', alternateRank: 1 } });
      const r = await splitThree(); const set = await readSessakuPieceSet(prisma, laterKey());
      expect(r.affectedItemIds).toContain(laterParent.itemId);
      const overrides = await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: other, itemKey: { in: set!.pieces.map((piece) => `piece:${piece.id}`) } }, orderBy: { alternateRank: 'asc' } });
      expect(overrides.map((override) => [override.overrideResourceCd, override.alternateRank])).toEqual([['581', 1], ['581', 2], ['581', 3]]);
    });
    it('mirrors resplit, nonadjacent merge and full merge while retaining surviving linked IDs', async () => {
      let r = await splitThree(); const first = await readSessakuPieceSet(prisma, laterKey());
      const target = r.pieces[1];
      r = await splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: target.pieceId, itemRevision: target.itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 1] });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => [piece.position, piece.quantity])).toEqual([[1, 1], [2, 1], [3, 1], [4, 2]]);
      r = await merge(r, [r.pieces[0], r.pieces[3]]);
      const merged = await readSessakuPieceSet(prisma, laterKey());
      expect(merged?.pieces.map((piece) => [piece.position, piece.quantity, piece.sourcePieceId])).toEqual(r.pieces.map((piece) => [piece.piecePosition, piece.quantity, piece.pieceId]));
      expect(merged!.version).toBeGreaterThan(first!.version);
      r = await merge(r);
      expect(r.pieces).toEqual([]); expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
      expect(await laterItems()).toMatchObject([{ kind: 'row', plannedQuantity: 5 }]);
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: { in: [site, other] }, itemKey: { startsWith: 'piece:' } } })).toBe(0);
    });
    it('keeps cross-process ranks consistent on the same machine without restoring removed IDs', async () => {
      const laterParent = (await laterItems())[0];
      await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey: laterParent.itemId, overrideResourceCd: '1', alternateRank: 2 } });
      let r = await splitThree();
      const removed = [r.pieces[0].itemId, r.pieces[2].itemId, ...(await laterItems()).filter((piece) => piece.sourcePieceId === r.pieces[0].pieceId || piece.sourcePieceId === r.pieces[2].pieceId).map((piece) => piece.itemId)];
      r = await merge(r, [r.pieces[0], r.pieces[2]]);
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: site, itemKey: { in: removed } } })).toBe(0);
      const items = (await allBoard()).items.filter((item) => !item.isCompleted && item.effectiveResourceCd === '1');
      expect(items.map((item) => item.alternateRank)).toEqual([1, 2, 3, 4]);
      await merge(r);
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: site, itemKey: { startsWith: 'piece:' } } })).toBe(0);
    });
    it('follows cutting quantity growth, shrink and a different later planned total', async () => {
      await splitThree();
      for (const [total, expected] of [[7, [1, 2, 4]], [4, [1, 2, 1]]] as const) {
        await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: total } });
        await quantity(total);
        expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual(expected);
      }
      await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 6 } });
      await quantity(5);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 3]);
      await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 2 } });
      await quantity(5);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1]);
    });
    it('completes later pieces independently and publishes only their own Progress', async () => {
      await splitThree(); let items = await laterItems();
      for (const item of items) {
        const current = (await laterItems()).find((piece) => piece.pieceId === item.pieceId)!;
        await complete(current);
      }
      expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(true);
      expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((piece) => !piece.isCompleted)).toBe(true);
      items = await laterItems(); await complete(items[0], 'incomplete');
      expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(false);
    });
    it('rejects cutting split and merge when any linked later piece is completed', async () => {
      const r = await splitThree(); await complete((await laterItems())[0]);
      const p = r.pieces[1];
      await expect(splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: p.pieceId, itemRevision: p.itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 1] })).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_COMPLETED' });
      await expect(merge(r, [r.pieces[1], r.pieces[2]])).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_COMPLETED' });
      expect((await readSessakuPieceSet(prisma, key()))?.pieces).toHaveLength(3);
    });
    it('rejects direct later split and merge, even if its resource category is cutting', async () => {
      await splitThree(); const items = await laterItems(); const p = items[1];
      await expect(splitSessakuPieces({ siteKey: site, parentItemId: p.parentItemId!, targetPieceId: p.pieceId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion!, quantities: [1, 1] })).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_LOCKED' });
      await expect(mergeSessakuPieces({ siteKey: site, parentItemId: p.parentItemId!, pieceIds: items.map((piece) => piece.pieceId!), itemRevisions: Object.fromEntries(items.map((piece) => [piece.itemId, piece.itemRevision])), expectedPieceSetVersion: p.pieceSetVersion! })).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_LOCKED' });
    });
    it.each(['external', 'progress', 'own-pieces', 'earlier', 'other-part'])('excludes ineligible later rows (%s)', async (kind) => {
      if (kind === 'external') await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, isExternallyCompleted: true } });
      if (kind === 'progress') await prisma.productionScheduleProgress.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, isCompleted: true } });
      if (kind === 'own-pieces') await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...laterKey(), pieces: { create: { position: 1, quantity: 5 } } } });
      if (kind === 'earlier' || kind === 'other-part') await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '2', FKOJUN: kind === 'earlier' ? '0' : '2', FHINCD: kind === 'other-part' ? 'OTHER' : 'PART-A' } } });
      await splitThree();
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.some((piece) => piece.sourcePieceId) ?? false).toBe(false);
    });
    it('leaves later rows imported after the first split unsplit', async () => {
      const r = await splitThree();
      const added = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '3', FSIGENCD: '3' }, occurredAt: new Date(), dataHash: `${site}-late` } });
      await merge(r, [r.pieces[0], r.pieces[2]]);
      expect((await allBoard()).items.find((item) => item.sourceRowId === added.id)?.kind).toBe('row');
    });
  });

});
