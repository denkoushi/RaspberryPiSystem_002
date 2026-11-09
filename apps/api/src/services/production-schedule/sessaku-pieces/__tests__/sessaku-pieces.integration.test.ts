import { readFileSync } from 'node:fs';
import { autoUnitSplitCandidateSql } from '../auto-unit-split-candidates.js';
import { getGrindingPlanningBoardResourceCapacity } from '../../grinding-planning-board-resource-capacity.service.js';
import { getResourceCategoryPolicy, isProductionScheduleCuttingResourceCd } from '../../policies/resource-category-policy.service.js';
import { autoUnitSplitCandidates, autoSplitSessakuUnits } from '../auto-unit-split.service.js';
import { updateGrindingPlanningBoardResourcePartMinutes, getGrindingPlanningBoardResourceMinutes, updateGrindingPlanningBoardResourceMinutesSource } from '../../grinding-planning-board-resource-minutes.service.js';
import Fastify from 'fastify';
import * as projectionSource from '../../grinding-planning-board/source.js';
import { runSessakuPieceOperation, type PieceAuditContext, type PieceOperationTiming } from '../piece-audit.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../../grinding-planning-board-projection.js';
import { readOverrides, readRanks, readRowDetails, readWinnerRowsByFseibans } from '../../grinding-planning-board/source.js';
import { registerErrorHandler } from '../../../../plugins/error-handler.js';
import { registerSessakuPiecesRoutes } from '../../../../routes/kiosk/production-schedule/sessaku-pieces.js';
import { buildOrderSupplementKey, buildReplacementCreateInputs, runOrderSupplementReplacementTransaction, toSupplementNormalizedRow } from '../../order-supplement-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from '../../external-completion/fkojunst-external-completion-sync.repository.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../../fkojunst-status-mail-critical-lock.js';
import { getGrindingPlanningBoardDueScope, updateGrindingPlanningBoardDueScope } from '../../grinding-planning-board-due-scope.service.js';
import { readPlanningSnapshotGenerationToken } from '../../grinding-planning-board/state.js';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import { createPrismaClient } from '../../../../lib/prisma-client.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../constants.js';
import { getGrindingPlanningBoard, updateGrindingPlanningBoardArrival, updateGrindingPlanningBoardRank, updateGrindingPlanningBoardResourceOrder } from '../../grinding-planning-board.service.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../../leaderboard/leaderboard-shell-snapshot.store.js';
import { splitSessakuPieces, mergeSessakuPieces, setSessakuPieceCompletion, setSessakuPieceOpCompletion } from '../sessaku-pieces.service.js';
import { encodeSessakuPieceKey, acquireSessakuPieceLogicalLocks, sessakuPieceKeyFromRow, readSessakuPieceSet, readSessakuPieceSets, findSessakuPieceWinner } from '../piece-key.js';
import { publishSessakuPieceSourceCreates } from '../piece-source-publication.js';
import { reconcileSessakuPieceQuantities } from '../piece-quantity.js';
import { reconcileSessakuPieceProgress } from '../piece-completion.js';
import { lockSessakuPieceSourceRows, publishSessakuPieceProgress, readSessakuPiecePublicationState, synchronizeSessakuPieceSources } from '../piece-sync.js';
import { driveProductionScheduleRowCompletion, setProductionScheduleRowCompletionIntent } from '../../production-schedule-command.service.js';
import { ProgressSyncFromCsvService } from '../../progress-sync-from-csv.service.js';
import { CsvDashboardIngestor } from '../../../csv-dashboard/csv-dashboard-ingestor.js';
import { calculateProductionScheduleDataHash, PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from '../../row-resolver/index.js';
import { readGrindingPlanningBoardLoadSummary } from '../../grinding-planning-board-load-summary.js';
import { enrichRowsWithProcessArrival } from '../../process-arrival.service.js';
import type { GrindingPlanningBoardItem, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';

const winnerMaterializations = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../row-resolver/max-product-no-winner-materialization.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../row-resolver/max-product-no-winner-materialization.js')>();
  const counted = <T extends (...args: never[]) => unknown>(fn: T) => ((...args: Parameters<T>) => { winnerMaterializations.count += 1; return fn(...args); }) as T;
  return { ...actual,
    fetchMaxProductNoWinnerRowIdsForDashboard: counted(actual.fetchMaxProductNoWinnerRowIdsForDashboard),
    buildProductionScheduleLeaderboardMaterializedWinners: counted(actual.buildProductionScheduleLeaderboardMaterializedWinners),
    buildProductionScheduleLeaderboardMaterializedBaseWhere: counted(actual.buildProductionScheduleLeaderboardMaterializedBaseWhere),
    resolveLeaderboardMaterializedBaseWhere: counted(actual.resolveLeaderboardMaterializedBaseWhere) };
});

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
    await prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleSessakuPieceAuditLog.deleteMany({ where: { fseiban: seiban } });
    await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleSessakuPieceHistory.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: dashboardId, dataHash: { startsWith: site } } });
    await prisma.dueManagementOutcomeEvent.deleteMany({ where: { fseiban: seiban } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await reader.$disconnect(); await prisma.$disconnect(); });
  it('backfills deleted pre-feature manual keys from successful split/merge audits exactly and idempotently', async () => {
    const keys = [
      { fseiban: seiban, fhincd: '\t手動 品番\u3000', fsigencd: ' 021', fkojun: '０１０' },
      { fseiban: seiban, fhincd: 'MERGED', fsigencd: '022', fkojun: '20' }
    ];
    const ignored = { ...keys[0], fhincd: 'REJECTED' };
    const audit = (key: typeof ignored, action: string, outcome = 'success') => ({
      action, outcome, fseiban: seiban, parentItemId: `row:${Buffer.from(encodeSessakuPieceKey(key)).toString('base64url')}`,
      httpStatus: outcome === 'success' ? 200 : 409, pieceIds: [], beforeJson: {}, afterJson: {}, itemRevisions: {}
    });
    await prisma.productionScheduleSessakuPieceAuditLog.createMany({ data: [
      audit(keys[0], 'split'), audit(keys[0], 'merge'), audit(keys[1], 'merge'),
      audit(ignored, 'split', 'rejected'), audit(ignored, 'merge', 'failed'), audit(ignored, 'complete'),
      // Malformed parentItemId values must be skipped without aborting the migration.
      ...['row:', 'row:!!!', 'abc', `row:${Buffer.from([0xff, 0xfe]).toString('base64url')}`, `row:${Buffer.from('{oops').toString('base64url')}`,
        `row:${Buffer.from('[1,2,3,4]').toString('base64url')}`].map((parentItemId) => ({ ...audit(ignored, 'split'), parentItemId })),
      { ...audit(ignored, 'merge'), parentItemId: null }
    ] });
    // Neither a PieceSet nor a current CSV row remains for these logical keys.
    const migration = readFileSync(new URL('../../../../../prisma/migrations/20261109130000_sessaku_unit_split_ops/migration.sql', import.meta.url), 'utf8');
    const backfill = migration.slice(migration.indexOf('DO $$'));
    for (let run = 0; run < 2; run++) {
      await prisma.$executeRawUnsafe(backfill);
      const saved = await prisma.productionScheduleSessakuPieceHistory.findMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
      expect(saved.map(encodeSessakuPieceKey).sort()).toEqual(keys.map(encodeSessakuPieceKey).sort());
    }
    const policy = await getResourceCategoryPolicy({ siteKey: site });
    // A disappeared manual key returning in CSV must stay excluded; a different raw key stays eligible.
    for (const key of [keys[0], { ...keys[0], fhincd: 'UNTOUCHED' }]) {
      const data = { ...rowData, FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun };
      const created = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: data, occurredAt: new Date(), dataHash: `${site}-${key.fhincd}` } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: created.id,
        sourceCsvDashboardId: site, productNo: key.fhincd === 'UNTOUCHED' ? '124' : '123', resourceCd: key.fsigencd, processOrder: key.fkojun, plannedQuantity: 3 } });
      const candidates = await prisma.$queryRaw<Array<{ id: string }>>(autoUnitSplitCandidateSql(site, [seiban], policy));
      expect(candidates.some((candidate) => candidate.id === created.id)).toBe(key.fhincd === 'UNTOUCHED');
    }
  });
  it('preserves other-site operation evidence while filling only the saved site definition', async () => {
    const save = (siteKey: string, opNos: number[]) => updateGrindingPlanningBoardResourcePartMinutes({
      siteKey, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 1, setupMinutes: 0, ops: opNos.map((opNo) => ({ opNo, minutes: 1 }))
    });
    await save(site, [1]); await save(other, [2, 3]);
    const result = await split();
    const pieceId = result.pieces[0].pieceId!;
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId, opNo: 2 } });
    await save(site, [4]);
    expect((await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId }, orderBy: { opNo: 'asc' } })).map((op) => op.opNo)).toEqual([2, 4]);
    await save(other, []);
    expect((await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId }, orderBy: { opNo: 'asc' } })).map((op) => op.opNo)).toEqual([4]);
  });
  it('auto-splits once across two concurrent terminals, propagates later pieces and retains the manual merge marker', async () => {
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId,
      siteKey: site, itemKey: (await parent()).itemId, overrideResourceCd: '021' } });
    const results = await Promise.all([autoSplitSessakuUnits({ siteKey: site }), autoSplitSessakuUnits({ siteKey: site })]);
    expect(results.reduce((sum, result) => sum + result.splitCount, 0)).toBe(1);
    const saved = (await readSessakuPieceSet(prisma, key()))!;
    expect(saved.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1, 1, 1]);
    const later = await prisma.productionScheduleSessakuPieceSet.findFirst({ where: { sourcePieceSetId: saved.id }, include: { pieces: true } });
    expect(later?.pieces).toHaveLength(5);
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(0);
    const parentId = (await parent()).itemId;
    const current = (await board()).items.filter((item) => item.parentItemId === parentId);
    await mergeSessakuPieces({ siteKey: site, parentItemId: (await parent()).itemId,
      pieceIds: current.map((item) => item.pieceId!), expectedPieceSetVersion: saved.version,
      itemRevisions: Object.fromEntries(current.map((item) => [item.itemId, item.itemRevision])) });
    expect((await readSessakuPieceSet(prisma, key()))?.pieces).toHaveLength(0);
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(0);
  });
  it.each([false, true])('unit quantity growth follows effective resource settings (disabled=%s), preserves records and links later units', async (disabled) => {
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId,
      siteKey: site, itemKey: (await parent()).itemId, overrideResourceCd: '021' } });
    await quantity(10);
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(1);
    const before = (await readSessakuPieceSet(prisma, key()))!;
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId: before.pieces[0].id, opNo: 1 } });
    if (disabled) await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.create({ data: {
      csvDashboardId: dashboardId, siteKey: site, resourceCd: '021', dailyHours: 8, unitSplitEnabled: false
    } });
    await quantity(12);
    const saved = (await readSessakuPieceSet(prisma, key()))!;
    expect(saved.pieces.map((piece) => piece.quantity)).toEqual(disabled ? [...Array(9).fill(1), 3] : Array(12).fill(1));
    expect(saved.pieces.slice(0, 10).map((piece) => piece.id)).toEqual(before.pieces.map((piece) => piece.id));
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: before.pieces[0].id } })).toBe(1);
    if (!disabled) {
      await quantity(53);
      const capped = (await readSessakuPieceSet(prisma, key()))!;
      expect(capped.pieces).toHaveLength(50);
      expect(capped.pieces[49].quantity).toBe(4);
      const later = (await prisma.productionScheduleSessakuPieceSet.findFirst({ where: { sourcePieceSetId: capped.id }, include: { pieces: { orderBy: { position: 'asc' } } } }))!;
      expect(later.pieces.map((piece) => [piece.sourcePieceId, piece.quantity])).toEqual(capped.pieces.map((piece) => [piece.id, piece.quantity]));
      const stable = await readSessakuPieceSet(prisma, key());
      await quantity(53);
      expect(await readSessakuPieceSet(prisma, key())).toEqual(stable);
    }
  });
  it('uses the disabled parent resource for growth after all existing pieces move to an enabled resource', async () => {
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId,
      siteKey: site, itemKey: (await parent()).itemId, overrideResourceCd: '021' } });
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(1);
    const before = (await readSessakuPieceSet(prisma, key()))!;
    expect((await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({
      where: { csvDashboardId: dashboardId, siteKey: site, itemKey: { in: before.pieces.map((piece) => `piece:${piece.id}`) } },
      data: { overrideResourceCd: '022' }
    })).count).toBe(5);
    await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.create({ data: {
      csvDashboardId: dashboardId, siteKey: site, resourceCd: '021', dailyHours: 8, unitSplitEnabled: false
    } });
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
    const completed = (await readSessakuPieceSet(prisma, key()))!;
    expect(completed.pieces.every((piece) => piece.isCompleted)).toBe(true);
    await quantity(7);
    const saved = (await readSessakuPieceSet(prisma, key()))!;
    expect(saved.pieces).toHaveLength(6);
    expect(saved.pieces.slice(0, 5)).toEqual(completed.pieces);
    expect(saved.pieces[5]).toMatchObject({ quantity: 2, isCompleted: false });
    expect((await board()).items.find((item) => item.pieceId === saved.pieces[5].id)?.effectiveResourceCd).toBe('021');
  });
  it('pages past six nonnumeric later-process SQL candidates and splits the eligible tail in one call', async () => {
    const lots = Array.from({ length: 8 }, (_, i) => ({ ...rowData, FHINCD: `LOT-${i}`, FSIGENCD: '021', FKOJUN: '10A' }))
      .sort((a, b) => Buffer.compare(Buffer.from(buildGrindingPlanningBoardRowItemId(a)), Buffer.from(buildGrindingPlanningBoardRowItemId(b))));
    const tail = lots.at(-1)!;
    const rejectedIds: string[] = [];
    for (const [index, data] of lots.entries()) {
      const row = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: data,
        occurredAt: new Date(), dataHash: `${site}-paged-${index}` } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: row.id,
        sourceCsvDashboardId: site, productNo: `paged-${index}`, resourceCd: '021', processOrder: '10A', plannedQuantity: 3 } });
      if (data !== tail) {
        rejectedIds.push(row.id);
        await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId,
          rowData: { ...data, FSIGENCD: '305', FKOJUN: '1' }, occurredAt: new Date(), dataHash: `${site}-predecessor-${index}` } });
      }
    }
    const policy = await getResourceCategoryPolicy({ siteKey: site });
    const firstPage = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`${autoUnitSplitCandidateSql(site, [seiban], policy)} LIMIT 6`);
    expect(firstPage).toHaveLength(6);
    for (const row of firstPage) expect(rejectedIds).toContain(row.id);
    expect(await autoSplitSessakuUnits({ siteKey: site })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect((await readSessakuPieceSet(prisma, sessakuPieceKeyFromRow(tail)))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1]);
    expect(await prisma.productionScheduleSessakuPieceSet.count({ where: { csvDashboardId: dashboardId, fseiban: seiban } })).toBe(1);
  });
  it('retains legacy manual history after adoption and removal as a later-process set', async () => {
    let result = await split();
    const merge = async (current: SessakuPiecesMutationResponse) => mergeSessakuPieces({ siteKey: site,
      parentItemId: current.parentItemId, expectedPieceSetVersion: current.pieceSetVersion,
      pieceIds: current.pieces.map((item) => item.pieceId!), itemRevisions: Object.fromEntries(current.pieces.map((item) => [item.itemId, item.itemRevision])) });
    await merge(result);
    // Simulate a pre-feature manual tombstone: no backfill is needed on migration.
    await prisma.productionScheduleSessakuPieceHistory.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    const earlierData = { ...rowData, FKOJUN: '0' };
    const earlier = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: earlierData,
      occurredAt: new Date(), dataHash: `${site}-earlier` } });
    await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: earlier.id,
      sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: '0', plannedQuantity: 5 } });
    const earlierParent = (await board(false)).items.find((item) => item.sourceRowId === earlier.id)!;
    result = await splitSessakuPieces({ siteKey: site, parentItemId: earlierParent.itemId,
      expectedPieceSetVersion: 0, itemRevision: earlierParent.itemRevision, quantities: [2, 3] });
    await merge(result);
    expect(await readSessakuPieceSet(prisma, key())).toBeNull();
    await prisma.csvDashboardRow.delete({ where: { id: earlier.id } });
    const parentId = (await parent()).itemId;
    await prisma.productionScheduleGrindingPlanningBoardOverride.upsert({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey: site, itemKey: parentId } },
      create: { csvDashboardId: dashboardId, siteKey: site, itemKey: parentId, overrideResourceCd: '021' },
      update: { overrideResourceCd: '021' }
    });
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(0);
    expect(await prisma.productionScheduleSessakuPieceHistory.findUnique({ where: {
      csvDashboardId_fseiban_fhincd_fsigencd_fkojun: { csvDashboardId: dashboardId, ...key() }
    } })).not.toBeNull();
  });
  it('auto-splits successive lots in the same lane after the first split changes their ranks', async () => {
    const extraData = { ...rowData, FHINCD: 'PART-B', ProductNo: '124' };
    const extra = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: extraData, occurredAt: new Date(), dataHash: `${site}-extra` } });
    await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: extra.id,
      sourceCsvDashboardId: site, productNo: '124', resourceCd: '1', processOrder: '1', plannedQuantity: 3 } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.createMany({ data: [rowData, extraData].map((data, index) => ({
      csvDashboardId: dashboardId, siteKey: site, itemKey: buildGrindingPlanningBoardRowItemId(data), overrideResourceCd: '021', alternateRank: index + 1
    })) });
    expect((await autoSplitSessakuUnits({ siteKey: site })).splitCount).toBe(2);
    expect((await readSessakuPieceSet(prisma, sessakuPieceKeyFromRow(extraData)))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1]);
  });
  it('operation completion updates the piece and parent and undo reopens both', async () => {
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId,
      siteKey: site, itemKey: (await parent()).itemId, overrideResourceCd: '021' } });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '021', fhincd: 'PART-A',
      perUnitMinutes: 999, setupMinutes: 30, ops: [{ opNo: 1, minutes: 2 }, { opNo: 2, minutes: 3 }] });
    await updateGrindingPlanningBoardResourceMinutesSource({ siteKey: site, resourceCd: '021', source: 'own' });
    let result = await split();
    const pieceIds = result.pieces.map((item) => item.pieceId!);
    const apply = async (pieceId: string, opNo: number, intent: 'complete' | 'incomplete' = 'complete') => {
      const item = result.pieces.find((item) => item.pieceId === pieceId)!;
      result = await setSessakuPieceOpCompletion({ siteKey: site, pieceId, opNo, intent,
        expectedPieceSetVersion: result.pieceSetVersion, itemRevision: item.itemRevision });
    };
    await apply(pieceIds[0], 1); expect(result.parentIsCompleted).toBe(false);
    await apply(pieceIds[0], 2); expect(result.pieces[0].isCompleted).toBe(true); expect(result.parentIsCompleted).toBe(false);
    await apply(pieceIds[1], 1); await apply(pieceIds[1], 2);
    expect(result.parentIsCompleted).toBe(true);
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId } })).toMatchObject({ isCompleted: true });
    await apply(pieceIds[1], 2, 'incomplete');
    expect(result.pieces.find((item) => item.pieceId === pieceIds[1])).toMatchObject({ isCompleted: false, completedOpNos: [1] });
    expect(result.parentIsCompleted).toBe(false);
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId } })).toMatchObject({ isCompleted: false });
    const audit = await prisma.productionScheduleSessakuPieceAuditLog.findFirst({ where: { fseiban: seiban, action: 'op_uncomplete' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.afterJson).toMatchObject({ opNo: 2, completedOpNos: [1] });
  });
  it('replaces/clears operation definitions and keeps their sum in perUnitMinutes', async () => {
    // Explicit per-operation setup keeps the lot setup total (10) independent of legacy setup inheritance rules.
    const update = (ops?: { opNo: number; minutes: number; setupMinutes: number | null }[]) => updateGrindingPlanningBoardResourcePartMinutes({
      siteKey: site, resourceCd: '021', fhincd: 'PART-A', perUnitMinutes: 0.5, setupMinutes: 10, ops });
    await update([{ opNo: 2, minutes: 1.25, setupMinutes: null }, { opNo: 1, minutes: 2.75, setupMinutes: 10 }]);
    expect((await getGrindingPlanningBoardResourceMinutes({ siteKey: site })).values[0]).toMatchObject({ perUnitMinutes: 4,
      ops: [{ opNo: 1, minutes: 2.75 }, { opNo: 2, minutes: 1.25 }] });
    await update([{ opNo: 3, minutes: 6, setupMinutes: 10 }]);
    await expect(update()).rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_MINUTES_MISMATCH' });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '021', fhincd: 'PART-A', perUnitMinutes: 6, setupMinutes: 10 });
    expect((await getGrindingPlanningBoardResourceMinutes({ siteKey: site })).values[0]).toMatchObject({ perUnitMinutes: 6, ops: [{ opNo: 3, minutes: 6 }] });
    await update([]);
    expect((await getGrindingPlanningBoardResourceMinutes({ siteKey: site })).values[0]).toMatchObject({ perUnitMinutes: 0.5, ops: [] });
  });
  it('returns before projection source reads when every cutting key has a set/history', async () => {
    await split();
    const winners = vi.spyOn(projectionSource, 'readWinnerRowsByFseibans');
    const details = vi.spyOn(projectionSource, 'readRowDetails');
    try {
      expect(await autoSplitSessakuUnits({ siteKey: site })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
      expect(winners).not.toHaveBeenCalled(); expect(details).not.toHaveBeenCalled();
    } finally { winners.mockRestore(); details.mockRestore(); }
  });
  it('pages auto-unit-split candidates in the supplied board seiban order', async () => {
    const order = [`Z-${seiban}`, `A-${seiban}`];
    const ids = [];
    for (const fseiban of order) {
      const row = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId,
        rowData: { ...rowData, FSEIBAN: fseiban, FSIGENCD: '021' }, occurredAt: new Date(), dataHash: `${site}-${fseiban}` } });
      ids.push(row.id);
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: row.id,
        sourceCsvDashboardId: site, productNo: `123-${fseiban}`, resourceCd: '021', processOrder: '1', plannedQuantity: 5 } });
    }
    const policy = await getResourceCategoryPolicy({ siteKey: site });
    const query = (ordered: string[]) => prisma.$queryRaw<Array<{ id: string; fseiban: string; parentId: string }>>(
      Prisma.sql`${autoUnitSplitCandidateSql(site, ordered, policy)} LIMIT 1`);
    const first = await query(order);
    expect(first.map((row) => row.id)).toEqual([ids[0]]);
    expect((await query([...order].reverse())).map((row) => row.id)).toEqual([ids[1]]);
    const next = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`${autoUnitSplitCandidateSql(site, order, policy, [first[0].parentId])} LIMIT 1`);
    expect(next.map((row) => row.id)).toEqual([ids[1]]);
  });
  it('whole-piece completion records every operation and undo clears every record', async () => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 3,
      setupMinutes: 0, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
    let result = await split();
    result = await complete(result.pieces[0]);
    const pieceId = result.pieces[0].pieceId!;
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId }, select: { opNo: true }, orderBy: { opNo: 'asc' } }))
      .toEqual([{ opNo: 1 }, { opNo: 2 }]);
    result = await complete(result.pieces[0], 'incomplete');
    expect(result.pieces[0].isCompleted).toBe(false);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId } })).toBe(0);
  });
  it('keeps partial operations and versions on piece/parent incomplete intents, clearing only completed pieces', async () => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 3,
      setupMinutes: 0, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
    let result = await split();
    const partialId = result.pieces[0].pieceId!;
    result = await setSessakuPieceOpCompletion({ siteKey: site, pieceId: partialId, opNo: 1, intent: 'complete',
      expectedPieceSetVersion: result.pieceSetVersion, itemRevision: result.pieces[0].itemRevision });
    const version = result.pieceSetVersion;
    result = await complete(result.pieces.find((piece) => piece.pieceId === partialId)!, 'incomplete');
    expect(result.pieceSetVersion).toBe(version);
    expect(await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' }))
      .toMatchObject({ unchanged: true });
    expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(version);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: partialId }, select: { opNo: true } }))
      .toEqual([{ opNo: 1 }]);

    result = await complete(result.pieces.find((piece) => piece.pieceId !== partialId)!);
    const completedId = result.pieces.find((piece) => piece.pieceId !== partialId)!.pieceId!;
    expect(await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' }))
      .toMatchObject({ unchanged: false });
    const reopened = await readSessakuPieceSet(prisma, key());
    expect(reopened?.version).toBe(result.pieceSetVersion + 1);
    expect(reopened?.pieces.every((piece) => !piece.isCompleted)).toBe(true);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: completedId } })).toBe(0);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: partialId }, select: { opNo: true } }))
      .toEqual([{ opNo: 1 }]);
    expect(await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' }))
      .toMatchObject({ unchanged: true });
    expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(reopened?.version);
  });
  it('operation complete preserves an existing manual completion until an operation is undone', async () => {
    let result = await split(); result = await complete(result.pieces[0]);
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 3, setupMinutes: 0,
      ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
    // Model existing manual/external legacy evidence without operation records.
    await prisma.productionScheduleSessakuPiece.update({ where: { id: result.pieces[0].pieceId! }, data: { isCompleted: true, completedAt: new Date() } });
    const item = (await board()).items.find((i) => i.pieceId === result.pieces[0].pieceId)!;
    result = await setSessakuPieceOpCompletion({ siteKey: site, pieceId: item.pieceId!, opNo: 1, intent: 'complete',
      expectedPieceSetVersion: item.pieceSetVersion!, itemRevision: item.itemRevision });
    expect(result.pieces.find((i) => i.pieceId === item.pieceId)?.isCompleted).toBe(true);
    const updated = result.pieces.find((i) => i.pieceId === item.pieceId)!;
    result = await setSessakuPieceOpCompletion({ siteKey: site, pieceId: updated.pieceId!, opNo: 1, intent: 'incomplete',
      expectedPieceSetVersion: updated.pieceSetVersion!, itemRevision: updated.itemRevision });
    expect(result.pieces.find((i) => i.pieceId === item.pieceId)?.isCompleted).toBe(false);
  });
  it('preserves completion and parent on definition replacement/empty, fills new records and follows effective resources', async () => {
    const update = (ops: { opNo: number; minutes: number }[]) => updateGrindingPlanningBoardResourcePartMinutes({
      siteKey: site, resourceCd: '021', fhincd: 'PART-A', perUnitMinutes: 1, setupMinutes: 0, ops });
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site,
      itemKey: (await parent()).itemId, overrideResourceCd: '021' } });
    await update([{ opNo: 1, minutes: 1 }]);
    let result = await split();
    result = await complete(result.pieces[0]); result = await complete(result.pieces[1]);
    expect(result.parentIsCompleted).toBe(true);
    await update([{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }]);
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((p) => p.isCompleted)).toBe(true);
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId } })).toMatchObject({ isCompleted: true });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { piece: { pieceSet: { fseiban: seiban } } } })).toBe(4);
    await update([{ opNo: 1, minutes: 1 }]);
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((p) => p.isCompleted)).toBe(true);
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId } })).toMatchObject({ isCompleted: true });
    await update([]);
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((p) => p.isCompleted)).toBe(true);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { piece: { pieceSet: { fseiban: seiban } } } })).toBe(0);
    // This piece's own resource replaces the parent's inherited resource.
    expect((await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({ where: { csvDashboardId: dashboardId, siteKey: site,
      itemKey: result.pieces[0].itemId }, data: { overrideResourceCd: '022' } })).count).toBe(1);
    await update([{ opNo: 3, minutes: 1 }]);
    const pieces = (await readSessakuPieceSet(prisma, key()))!.pieces;
    expect(pieces[0].isCompleted).toBe(true); expect(pieces[1].isCompleted).toBe(true);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: pieces[0].id } })).toEqual([]);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: pieces[1].id }, select: { opNo: true } })).toEqual([{ opNo: 3 }]);
    await external(true);
    const before = await readSessakuPieceSet(prisma, key());
    await update([{ opNo: 4, minutes: 1 }]);
    expect(await readSessakuPieceSet(prisma, key())).toEqual(before);
  });
  it('definition reduction completes recorded pieces, publishes parent progress and downstream arrival', async () => {
    const update = (opNos: number[]) => updateGrindingPlanningBoardResourcePartMinutes({
      siteKey: site, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 1, setupMinutes: 0,
      ops: opNos.map((opNo) => ({ opNo, minutes: 1 })) });
    await update([1, 2]);
    const result = await split();
    await prisma.productionScheduleSessakuPieceOpCompletion.createMany({ data: result.pieces.map((piece) => ({ pieceId: piece.pieceId!, opNo: 1 })) });
    const before = (await readSessakuPieceSet(prisma, key()))!;
    await update([1]);
    const saved = (await readSessakuPieceSet(prisma, key()))!;
    expect(saved.pieces.every((piece) => piece.isCompleted && piece.completedAt !== null)).toBe(true);
    expect(saved.version).toBeGreaterThan(before.version);
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId } })).toMatchObject({ isCompleted: true });
    expect(await prisma.dueManagementOutcomeEvent.count({ where: { fseiban: seiban, eventType: 'manual_complete_set' } })).toBeGreaterThan(0);
    const later = (await board()).items.filter((item) => item.sourceRowId === nextRowId && item.kind === 'piece');
    expect(later).toHaveLength(2);
    expect(later.every((item) => !item.isCompleted)).toBe(true);
    const arrival = await enrichRowsWithProcessArrival([{ id: nextRowId, sourceRowId: nextRowId, rowData: { ...rowData, FKOJUN: '2' } }], { siteKey: site, locationKey: site });
    expect(arrival[0].arrived).toBe(true);
    // Added operations fill already completed pieces and do not reopen them.
    await update([1, 3]);
    expect((await readSessakuPieceSet(prisma, key()))!.pieces.every((piece) => piece.isCompleted)).toBe(true);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: { in: saved.pieces.map((piece) => piece.id) } } })).toBe(4);
  });
  it('parent row completion and cancellation synchronize all piece operations through effective resource definitions', async () => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '1', fhincd: 'PART-A', perUnitMinutes: 2, setupMinutes: 0,
      ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 1 }] });
    const result = await split();
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
    const completionAudit = await prisma.productionScheduleSessakuPieceAuditLog.findFirst({ where: { fseiban: seiban, action: 'complete', siteKey: site }, orderBy: { createdAt: 'desc' } });
    expect(completionAudit).toMatchObject({ outcome: 'success', beforeJson: { completedPieceIds: [] }, afterJson: { completedPieceIds: result.pieces.map((piece) => piece.pieceId) } });
    expect(completionAudit?.resultVersion).toBe((await readSessakuPieceSet(prisma, key()))!.version);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: { in: result.pieces.map((piece) => piece.pieceId!) } } })).toBe(4);
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: { in: result.pieces.map((piece) => piece.pieceId!) } } })).toBe(0);
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.every((piece) => !piece.isCompleted)).toBe(true);
    const cancellationAudit = await prisma.productionScheduleSessakuPieceAuditLog.findFirst({ where: { fseiban: seiban, action: 'uncomplete', siteKey: site }, orderBy: { createdAt: 'desc' } });
    expect(cancellationAudit).toMatchObject({ outcome: 'success', beforeJson: { completedPieceIds: result.pieces.map((piece) => piece.pieceId) }, afterJson: { completedPieceIds: [], operations: [] } });
  });
  it.each(['target', 'later', 'winnerless-later'])('quantity correction preserves partial operation evidence on %s', async (scope) => {
    const result = await split();
    const later = (await board()).items.filter((item) => item.sourceRowId === nextRowId && item.kind === 'piece');
    const protectedPiece = scope === 'target' ? result.pieces[1] : later[1];
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId: protectedPiece.pieceId!, opNo: 1 } });
    if (scope === 'winnerless-later') await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
    await quantity(3);
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: protectedPiece.pieceId! } })).toBe(1);
    expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: protectedPiece.pieceId! } })).toMatchObject({ isCompleted: false, quantity: 3 });
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((piece) => piece.id)).toEqual([result.pieces[1].pieceId]);
    await quantity(2);
    expect((await readSessakuPieceSet(prisma, key()))?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: protectedPiece.pieceId! } })).toBe(1);
  });
  it('rejects manual splits past 50 pieces before touching later pieces or history', async () => {
    await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: rowId }, data: { plannedQuantity: 52 } });
    const p = await parent();
    await expect(splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0,
      quantities: Array.from({ length: 52 }, () => 1) })).rejects.toMatchObject({ statusCode: 400, code: 'PIECE_QUANTITY_CONFLICT', message: '片は50までです' });
    expect(await readSessakuPieceSet(prisma, key())).toBeNull();
    expect(await prisma.productionScheduleSessakuPieceHistory.count({ where: { csvDashboardId: dashboardId, fseiban: seiban } })).toBe(0);
    const result = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0,
      quantities: [...Array.from({ length: 49 }, () => 1), 3] });
    const laterKey = sessakuPieceKeyFromRow({ ...rowData, FKOJUN: '2', FSIGENCD: '2' });
    const laterBefore = await readSessakuPieceSet(prisma, laterKey);
    const tailId = (await readSessakuPieceSet(prisma, key()))!.pieces.find((piece) => piece.quantity === 3)!.id;
    const tail = result.pieces.find((piece) => piece.pieceId === tailId)!;
    await expect(splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, targetPieceId: tail.pieceId!, itemRevision: tail.itemRevision,
      expectedPieceSetVersion: tail.pieceSetVersion!, quantities: [1, 2] })).rejects.toMatchObject({ statusCode: 400, code: 'PIECE_QUANTITY_CONFLICT', message: '片は50までです' });
    const after = await readSessakuPieceSet(prisma, key());
    expect(after?.pieces).toHaveLength(50);
    expect(after?.version).toBe(tail.pieceSetVersion);
    expect(await readSessakuPieceSet(prisma, laterKey)).toEqual(laterBefore);
  });

  it('later-row quantity correction deletes unrecorded pieces first and warns instead of dropping recorded work', async () => {
    await split();
    const pieces = (await board()).items.filter((item) => item.sourceRowId === nextRowId && item.kind === 'piece');
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId: pieces[1].pieceId!, opNo: 1 } });
    const laterKey = sessakuPieceKeyFromRow({ ...rowData, FKOJUN: '2', FSIGENCD: '2' });
    const correct = (total: number) => reader.$transaction(async (tx) => {
      await acquireSessakuPieceLogicalLocks(tx, [laterKey]);
      await reconcileSessakuPieceQuantities(tx, laterKey, total);
    });
    await correct(3);
    expect((await readSessakuPieceSet(prisma, laterKey))?.pieces.map((piece) => piece.id)).toEqual([pieces[1].pieceId]);
    await correct(2);
    expect((await readSessakuPieceSet(prisma, laterKey))?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: pieces[1].pieceId! } })).toBe(1);
  });
  it('definition writes normalize whitespace and reconcile records across site boards', async () => {
    rowData = { ...rowData, FHINCD: '\tPART-A\u3000' };
    await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData } });
    const result = await split();
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId: result.pieces[0].pieceId!, opNo: 9 } });
    await prisma.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: { csvDashboardId: dashboardId, siteKey: other } }, data: { seibanOrder: [] } });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: other, resourceCd: '1', fhincd: '\u3000PART-A\t', perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 2, minutes: 1 }] });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: result.pieces[0].pieceId!, opNo: 9 } })).toBe(0);
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '1', fhincd: '\u3000PART-A\t', perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 2, minutes: 1 }] });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: result.pieces[0].pieceId!, opNo: 9 } })).toBe(0);
  });
  it.each([
    { resource: '021', quantity: 2, expected: true }, { resource: '022', quantity: 50, expected: true },
    { resource: '021', quantity: 3, flag: false, expected: false }, { resource: '999', quantity: 3, flag: true, expected: true },
    { resource: '999', quantity: 3, expected: false }, { resource: '021', quantity: 1, expected: false },
    { resource: '021', quantity: 51, expected: false }, { resource: '021', quantity: 3, completed: true, expected: false },
    { resource: '021', quantity: 3, external: true, expected: false }, { resource: '021', quantity: 3, earlierGrinding: true, expected: false },
    { resource: '021', quantity: 3, touched: true, expected: false },
    { resource: '\t021\u3000', quantity: 3, expected: true },
    { resource: '０２１', quantity: 3, expected: false }, { resource: '０２１', quantity: 3, flag: true, expected: true },
    { resource: '021', quantity: 3, originalResource: '３０５', expected: true },
    { resource: '021', quantity: 3, originalResource: '\t305\u3000', expected: false },
    { resource: '021', quantity: 3, warning: 'INVALID_PLANNED_QUANTITY', expected: false },
    { resource: '021', quantity: 3, warning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN', expected: false },
    { resource: '021', quantity: 3, differentPart: ' PART-A ', expected: false },
    { resource: '021', quantity: 3, differentPart: 'ＰＡＲＴ-Ａ', expected: false }
  ])('SQL and TS candidate predicates agree: %j', async (scenario) => {
    if ('originalResource' in scenario) {
      rowData = { ...rowData, FSIGENCD: scenario.originalResource };
      await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData } });
    }
    const parentId = buildGrindingPlanningBoardRowItemId(rowData);
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey: parentId, overrideResourceCd: scenario.resource } });
    await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: rowId }, data: { plannedQuantity: scenario.quantity } });
    if ('flag' in scenario) await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.create({ data: {
      csvDashboardId: dashboardId, siteKey: site, resourceCd: scenario.resource.trim(), dailyHours: 8, unitSplitEnabled: scenario.flag } });
    if ('completed' in scenario) await prisma.productionScheduleProgress.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, isCompleted: true } });
    if ('external' in scenario) await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: rowId, isExternallyCompleted: true } });
    if ('earlierGrinding' in scenario) await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FHINCD: '\tPART-A\u3000', FKOJUN: '０', FSIGENCD: '305' } } });
    if ('differentPart' in scenario) await prisma.csvDashboardRow.update({ where: { id: nextRowId },
      data: { rowData: { ...rowData, FHINCD: scenario.differentPart, FKOJUN: '2', FSIGENCD: '305' } } });
    if ('warning' in scenario) await prisma.productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: dashboardId, ...key(), quantityWarning: scenario.warning, plannedQuantity: 3
    } });
    const touched = new Set<string>();
    if ('touched' in scenario) {
      await prisma.productionScheduleSessakuPieceHistory.create({ data: { csvDashboardId: dashboardId, ...key() } }); touched.add(parentId);
    }
    const policy = await getResourceCategoryPolicy({ siteKey: site });
    const sql = await prisma.$queryRaw<Array<{ id: string }>>(autoUnitSplitCandidateSql(site, [seiban], policy));
    const rows = await readWinnerRowsByFseibans(prisma, [seiban]);
    const items = projectGrindingPlanningBoard({ rows, details: await readRowDetails(prisma, rows.map((row) => row.id)),
      overrides: await readOverrides(prisma, site, rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData))),
      ranks: { rows: new Map() }, pieceSets: await readSessakuPieceSets(prisma, rows), seibanOrder: [seiban], category: 'all' }).items;
    const ts = autoUnitSplitCandidates(items, await getGrindingPlanningBoardResourceCapacity({ siteKey: site }),
      (cd) => isProductionScheduleCuttingResourceCd(cd, policy), touched);
    expect(sql.some((row) => row.id === rowId)).toBe(scenario.expected);
    expect(ts.some((item) => item.sourceRowId === rowId)).toBe(scenario.expected);
    expect(sql.map((row) => row.id).sort()).toEqual(ts.map((item) => item.sourceRowId).sort());
  });
  it.each([['A', 'a'], ['a', 'A'], ['0x20', '10'], ['∞', '20'], ['２０', '10'], ['10', '010'], ['2e1', '10']])(
    'keeps the SQL process prefilter a superset and re-evaluates after CSV change: %s/%s', async (process, earlier) => {
      rowData = { ...rowData, FSIGENCD: '021', FKOJUN: process };
      await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData } });
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FKOJUN: earlier, FSIGENCD: '305' } } });
      const policy = await getResourceCategoryPolicy({ siteKey: site });
      const load = async () => {
        const rows = await readWinnerRowsByFseibans(prisma, [seiban]);
        return projectGrindingPlanningBoard({ rows, details: await readRowDetails(prisma, rows.map((row) => row.id)),
          overrides: new Map(), ranks: { rows: new Map() }, seibanOrder: [seiban], category: 'all' }).items;
      };
      const sql = await prisma.$queryRaw<Array<{ id: string; parentId: string }>>(autoUnitSplitCandidateSql(site, [seiban], policy));
      const ts = autoUnitSplitCandidates(await load(), await getGrindingPlanningBoardResourceCapacity({ siteKey: site }),
        (cd) => isProductionScheduleCuttingResourceCd(cd, policy));
      for (const item of ts) expect(sql.map((row) => row.id)).toContain(item.sourceRowId);
      const rejected = sql.filter((row) => !ts.some((item) => item.sourceRowId === row.id));
      if (rejected.length) {
        // Each call evaluates the current rows again without request-to-request exclusions.
        await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '305' } } });
        const refreshed = await prisma.$queryRaw<Array<{ id: string }>>(autoUnitSplitCandidateSql(site, [seiban], policy));
        expect(refreshed.map((row) => row.id)).toContain(rowId);
      }
    });
  it('reconciles a piece selected by another site override and honors that site own override', async () => {
    const result = await split();
    const pieceId = result.pieces[0].pieceId!;
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId, opNo: 9 } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({
      where: { itemKey: `piece:${pieceId}`, siteKey: site }, data: { overrideResourceCd: '022' }
    });
    await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({
      where: { itemKey: `piece:${pieceId}`, siteKey: other }, data: { overrideResourceCd: '021' }
    });
    await prisma.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: { csvDashboardId: dashboardId, siteKey: site } }, data: { seibanOrder: [] } });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '021', fhincd: 'PART-A', perUnitMinutes: 1, setupMinutes: 0, ops: [{ opNo: 2, minutes: 1 }] });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId, opNo: 9 } })).toBe(0);
    await prisma.productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId, opNo: 9 } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({ where: { itemKey: `piece:${pieceId}`, siteKey: other }, data: { overrideResourceCd: null } });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '021', fhincd: 'PART-A', perUnitMinutes: 1, setupMinutes: 0, ops: [] });
    expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId, opNo: 9 } })).toBe(1);
  });
  it.each(['split', 'merge'].flatMap((action) => ['target', 'later'].map((scope) => ({ action, scope }))))(
    'rejects $action with partial operation evidence on $scope pieces', async ({ action, scope }) => {
      await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: scope === 'target' ? '1' : '2', fhincd: 'PART-A', perUnitMinutes: 3,
        setupMinutes: 0, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
      const result = await split();
      const target = scope === 'target' ? result.pieces[0] : (await board()).items.find((i) => i.sourceRowId === nextRowId && i.kind === 'piece')!;
      await setSessakuPieceOpCompletion({ siteKey: site, pieceId: target.pieceId!, opNo: 1, intent: 'complete',
        expectedPieceSetVersion: target.pieceSetVersion!, itemRevision: target.itemRevision });
      const items = (await board()).items.filter((i) => i.sourceRowId === rowId);
      const params = { siteKey: site, parentItemId: items[0].parentItemId!, expectedPieceSetVersion: items[0].pieceSetVersion! };
      await expect(action === 'split'
        ? splitSessakuPieces({ ...params, targetPieceId: items[0].pieceId!, itemRevision: items[0].itemRevision, quantities: [1, 1] })
        : mergeSessakuPieces({ ...params, pieceIds: items.map((i) => i.pieceId!), itemRevisions: Object.fromEntries(items.map((i) => [i.itemId, i.itemRevision])) }))
        .rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
      expect(await prisma.productionScheduleSessakuPieceOpCompletion.count({ where: { pieceId: target.pieceId! } })).toBe(1);
    });
  it('compares full and lane-scoped split/merge across four sites, 90 seiban and 7500 rows', async () => {
    const sites = [site, other, `${site}-third`, `${site}-fourth`];
    const seibans = Array.from({ length: 89 }, (_, i) => `P${i}-${seiban}`);
    const orders = sites.map((_, index) => {
      const order = [...seibans.slice(index * 10), ...seibans.slice(0, index * 10)]
        .filter((_, i) => index === 0 || (i + index) % 5 !== 0);
      // The fourth site is affected through an override despite not registering the target seiban.
      if (index !== 3) order.splice(20 + index, 0, seiban);
      return order;
    });
    const rows = seibans.flatMap((fseiban, i) =>
      Array.from({ length: 84 }, (_, j) => ({ id: randomUUID(), csvDashboardId: dashboardId,
        rowData: { ...rowData, FSEIBAN: fseiban, ProductNo: String(1000 + i), FKOJUN: String(j + 1),
          FSIGENCD: j === 0 && i < 40 ? (i === 0 ? '\t1\u3000' : '1') : j === 1 && i < 25 ? '3' : j === 2 && i < 20 ? '5' : j === 3 && i < 15 ? '6' : '2' },
        dataHash: `${site}-perf-${i}-${j}`, occurredAt: new Date() })));
    const pieceKeys = [seiban, ...seibans];
    const project = async (targetSite: string) => {
      const order = orders[sites.indexOf(targetSite)];
      const winners = await readWinnerRowsByFseibans(prisma, [...order, seiban]);
      return projectGrindingPlanningBoard({ rows: winners, details: await readRowDetails(prisma, winners.map((r) => r.id)),
        overrides: await readOverrides(prisma, targetSite), ranks: await readRanks(prisma, winners.map((r) => r.id), targetSite),
        pieceSets: await readSessakuPieceSets(prisma, winners), seibanOrder: order, category: 'all', view: 'resource', includePieces: true }).items;
    };
    const snapshot = async (client: Prisma.TransactionClient) => ({
      overrides: await client.productionScheduleGrindingPlanningBoardOverride.findMany({
        where: { csvDashboardId: dashboardId, siteKey: { in: sites } },
        select: { siteKey: true, itemKey: true, overrideResourceCd: true, overrideDueDate: true, dueDateCleared: true,
          alternateRank: true, orderPinned: true, specialDueKind: true, specialDueExpiresAt: true, version: true }
      }),
      states: await client.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: dashboardId, siteKey: { in: sites } },
        select: { siteKey: true, version: true, seibanOrder: true }, orderBy: { siteKey: 'asc' } }),
      pieceSets: await client.productionScheduleSessakuPieceSet.findMany({ where: { csvDashboardId: dashboardId, fseiban: { in: pieceKeys } },
        select: { fseiban: true, fhincd: true, fsigencd: true, fkojun: true, version: true, plannedQuantity: true, nextPosition: true, quantityWarning: true,
          pieces: { select: { id: true, sourcePieceId: true, position: true, quantity: true, isCompleted: true, completedAt: true }, orderBy: { position: 'asc' } } },
        orderBy: [{ fseiban: 'asc' }, { fhincd: 'asc' }, { fsigencd: 'asc' }, { fkojun: 'asc' }] }),
      ranks: await client.productionScheduleOrderAssignment.findMany({ where: { csvDashboardId: dashboardId, siteKey: { in: sites } },
        select: { csvDashboardRowId: true, resourceCd: true, location: true, siteKey: true, orderNumber: true }, orderBy: { id: 'asc' } }),
      progress: await client.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: rowId }, select: { isCompleted: true } })
    });
    const measurements: Array<{ action: string; full: PieceOperationTiming; scoped: PieceOperationTiming }> = [];
    const compareOperation = async (action: string, operation: (audit: PieceAuditContext) => Promise<SessakuPiecesMutationResponse>) => {
      const fullAudit: PieceAuditContext = { action, siteKey: site };
      const scopedAudit: PieceAuditContext = { action, siteKey: site };
      const rollback = new Error('rollback full-projection reference operation');
      const originalTransaction = prisma.$transaction.bind(prisma);
      const originalSource = projectionSource.readWinnerRowsByFseibans;
      const originalOverrides = projectionSource.readOverrides;
      // Restore the previous full source and site-wide override reads for the reference.
      const sourceSpy = vi.spyOn(projectionSource, 'readWinnerRowsByFseibans').mockImplementation((client, fseibans) => originalSource(client, fseibans));
      const overrideSpy = vi.spyOn(projectionSource, 'readOverrides').mockImplementation((client, targetSite) => originalOverrides(client, targetSite));
      let fullSnapshot!: Awaited<ReturnType<typeof snapshot>>;
      let fullResult!: SessakuPiecesMutationResponse;
      const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<SessakuPiecesMutationResponse>, options: object) =>
        originalTransaction(async (tx) => {
          fullResult = await callback(tx);
          fullSnapshot = await snapshot(tx);
          throw rollback;
        }, options).catch((error: unknown) => { if (error === rollback) return fullResult; throw error; })) as never);
      try { await runSessakuPieceOperation(fullAudit, operation); }
      finally { transactionSpy.mockRestore(); sourceSpy.mockRestore(); overrideSpy.mockRestore(); }
      const result = await runSessakuPieceOperation(scopedAudit, operation);
      const actual = JSON.parse(JSON.stringify(await snapshot(prisma))) as Awaited<ReturnType<typeof snapshot>>;
      // UUIDs/timestamps are generated per attempt. Compare every persisted business field,
      // mapping only the new piece IDs by their position (source rows and surviving IDs stay fixed).
      let expectedJson = JSON.stringify(fullSnapshot);
      for (const [index, set] of fullSnapshot.pieceSets.entries()) for (const piece of set.pieces) {
        const actualPiece = actual.pieceSets[index].pieces.find((p) => p.position === piece.position)!;
        expect(actualPiece).toBeDefined();
        expectedJson = expectedJson.replaceAll(piece.id, actualPiece.id);
      }
      const expected = JSON.parse(expectedJson) as typeof actual;
      for (const value of [expected, actual]) value.overrides.sort((a, b) => `${a.siteKey}:${a.itemKey}`.localeCompare(`${b.siteKey}:${b.itemKey}`));
      expect(actual).toEqual(expected);
      expect(fullAudit.timing!.sourceRowCount).toBe(rows.length + 2);
      expect(scopedAudit.timing!.sourceRowCount).toBeLessThan(200);
      measurements.push({ action, full: fullAudit.timing!, scoped: scopedAudit.timing! });
      return result;
    };
    try {
      await prisma.csvDashboardRow.createMany({ data: rows });
      await prisma.productionScheduleOrderSupplement.createMany({ data: rows.map((row) => ({
        csvDashboardId: dashboardId, csvDashboardRowId: row.id, sourceCsvDashboardId: site,
        productNo: row.rowData.ProductNo, resourceCd: row.rowData.FSIGENCD, processOrder: row.rowData.FKOJUN,
        plannedQuantity: 5, plannedEndDate: new Date('2026-12-15')
      })) });
      // Completed neighbours must remain unchanged; the selected lanes still have dozens of unfinished rows.
      await prisma.productionScheduleProgress.createMany({ data: rows.filter((row, i) => i % 84 === 0 && i / 84 < 8)
        .map((row) => ({ csvDashboardId: dashboardId, csvDashboardRowId: row.id, isCompleted: true })) });
      const inboundParent = rows.find((row) => row.rowData.FSEIBAN === seibans[60] && row.rowData.FKOJUN === '1')!;
      const inboundSet = await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId,
        ...sessakuPieceKeyFromRow(inboundParent.rowData), plannedQuantity: 5, nextPosition: 3,
        pieces: { create: [{ quantity: 2, position: 1 }, { quantity: 3, position: 2 }] } }, include: { pieces: { orderBy: { position: 'asc' } } } });
      const p = await parent();
      const laterParentId = buildGrindingPlanningBoardRowItemId({ ...rowData, FKOJUN: '2', FSIGENCD: '2' });
      for (const [index, targetSite] of sites.entries()) {
        await prisma.productionScheduleGrindingPlanningBoardState.upsert({
          where: { csvDashboardId_siteKey: { csvDashboardId: dashboardId, siteKey: targetSite } },
          create: { csvDashboardId: dashboardId, siteKey: targetSite, seibanOrder: orders[index] }, update: { seibanOrder: orders[index] }
        });
        await prisma.productionScheduleOrderAssignment.createMany({ data: rows.map((row, i) => ({
          csvDashboardId: dashboardId, csvDashboardRowId: row.id, siteKey: targetSite, location: targetSite,
          resourceCd: row.rowData.FSIGENCD, orderNumber: rows.length - i
        })) });
        const resource = index % 2 === 0 ? '1' : '3';
        const inboundRow = rows.find((row) => row.rowData.FSEIBAN === seibans[70 + index] && row.rowData.FKOJUN === '1')!;
        const outbound = rows.find((row) => row.rowData.FSEIBAN === seibans[15] && row.rowData.FKOJUN === '1')!;
        await prisma.productionScheduleGrindingPlanningBoardOverride.createMany({ data: [
          ...rows.filter((row) => row.rowData.FSIGENCD === '2' && row.rowData.FKOJUN !== '1').slice(0, 1600).map((row, i) => ({
            csvDashboardId: dashboardId, siteKey: targetSite, itemKey: buildGrindingPlanningBoardRowItemId(row.rowData),
            alternateRank: i + 1, orderPinned: i % 2 === 0, dueDateCleared: true
          })),
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: laterParentId, alternateRank: 10 + index,
            overrideResourceCd: index % 2 === 0 ? '5' : '6', dueDateCleared: true, orderPinned: true },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: buildGrindingPlanningBoardRowItemId(rows.find((row) => row.rowData.FSEIBAN === seibans[80] && row.rowData.FKOJUN === '5')!.rowData),
            overrideResourceCd: index % 2 === 0 ? '5' : '6', alternateRank: 2 },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: p.itemId, alternateRank: 20 + index,
            overrideResourceCd: resource, overrideDueDate: new Date('2026-12-01'), dueDateCleared: false, orderPinned: true },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: buildGrindingPlanningBoardRowItemId(inboundRow.rowData), overrideResourceCd: resource, alternateRank: 2,
            specialDueKind: 'overnight', specialDueExpiresAt: new Date('2099-12-01') },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: buildGrindingPlanningBoardRowItemId(outbound.rowData), overrideResourceCd: '2', alternateRank: 3 },
          // One piece moves into the lane. Its sibling has its own null override and stays on original resource 2.
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: buildGrindingPlanningBoardRowItemId(inboundParent.rowData), overrideResourceCd: '4' },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: `piece:${inboundSet.pieces[0].id}`, overrideResourceCd: `\t${resource}\u3000`, alternateRank: 4 },
          { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: `piece:${inboundSet.pieces[1].id}`, overrideResourceCd: null, alternateRank: 5 }
        ] });
      }
      const before = await Promise.all(sites.map(project));
      const current = before[0].find((item) => item.itemId === p.itemId)!;
      winnerMaterializations.count = 0;
      let result = await compareOperation('split', (audit) => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId,
        itemRevision: current.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 2, 2], audit }));
      expect(result.pieces.map((item) => item.quantity)).toEqual([1, 2, 2]);
      for (const [index, targetSite] of sites.entries()) {
        const resource = index % 2 === 0 ? '1' : '3';
        const laterResource = index % 2 === 0 ? '5' : '6';
        const projected = await project(targetSite);
        const later = projected.filter((item) => item.sourceRowId === nextRowId);
        expect(later.map((item) => [item.quantity, item.sourcePieceId])).toEqual(result.pieces.map((item) => [item.quantity, item.pieceId]));
        const overrides = await readOverrides(prisma, targetSite);
        for (const laneResource of [resource, laterResource]) {
          const lane = before[index].filter((item) => item.effectiveResourceCd === laneResource && !item.isCompleted);
          const expected = lane.flatMap((item) => item.itemId === p.itemId ? result.pieces.map((piece) => piece.itemId) : item.sourceRowId === nextRowId ? later.map((piece) => piece.itemId) : [item.itemId]);
          const after = projected.filter((item) => item.effectiveResourceCd === laneResource && !item.isCompleted);
          expect(after.map((item) => item.itemId)).toEqual(expected);
          expect(after.map((item) => item.alternateRank)).toEqual(expected.map((_, i) => i + 1));
        }
        for (const item of result.pieces) expect(overrides.get(item.itemId)).toMatchObject({ overrideResourceCd: resource, overrideDueDate: new Date('2026-12-01'), dueDateCleared: false, orderPinned: true, version: 1 });
        for (const item of later) expect(overrides.get(item.itemId)).toMatchObject({ overrideResourceCd: laterResource, dueDateCleared: true, orderPinned: true, version: 1 });
      }
      // The middle piece has a different resource at each site. Re-split and non-adjacent merges must retain both affected lanes.
      for (const [index, targetSite] of sites.entries()) await prisma.productionScheduleGrindingPlanningBoardOverride.update({
        where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey: targetSite, itemKey: result.pieces[1].itemId } },
        data: { overrideResourceCd: index % 2 === 0 ? '3' : '1', overrideDueDate: null, dueDateCleared: true }
      });
      const middle = (await project(site)).find((item) => item.pieceId === result.pieces[1].pieceId)!;
      const resplitVersion = result.pieceSetVersion;
      result = await compareOperation('resplit', (audit) => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId,
        targetPieceId: middle.pieceId!, itemRevision: middle.itemRevision, expectedPieceSetVersion: resplitVersion, quantities: [1, 1], audit }));
      const partial = result.pieces.filter((item) => item.piecePosition === 1 || item.piecePosition === 4);
      const partialVersion = result.pieceSetVersion;
      result = await compareOperation('partial-merge', (audit) => mergeSessakuPieces({ siteKey: site, parentItemId: p.itemId,
        expectedPieceSetVersion: partialVersion, pieceIds: partial.map((item) => item.pieceId!), itemRevisions: Object.fromEntries(partial.map((item) => [item.itemId, item.itemRevision])), audit }));
      const remaining = result.pieces;
      const mergeVersion = result.pieceSetVersion;
      const inheritedCutting = await Promise.all(sites.map(async (targetSite) => {
        const first = (await project(targetSite)).find((item) => remaining.some((piece) => piece.pieceId === item.pieceId))!;
        return (await readOverrides(prisma, targetSite)).get(first.itemId)!;
      }));
      const merged = await compareOperation('merge', (audit) => mergeSessakuPieces({ siteKey: site, parentItemId: p.itemId,
        expectedPieceSetVersion: mergeVersion, pieceIds: remaining.map((item) => item.pieceId!), itemRevisions: Object.fromEntries(remaining.map((item) => [item.itemId, item.itemRevision])), audit }));
      expect(merged.pieces).toEqual([]);
      expect(merged.pieceSetVersion).toBe(result.pieceSetVersion + 1);
      for (const [index, targetSite] of sites.entries()) {
        const projected = await project(targetSite);
        for (const resource of ['1', '3', index % 2 === 0 ? '5' : '6']) {
          const isNeighbour = (item: GrindingPlanningBoardItem) => item.sourceRowId !== rowId && item.sourceRowId !== nextRowId;
          const expected = before[index].filter((item) => item.effectiveResourceCd === resource && !item.isCompleted && isNeighbour(item)).map((item) => item.itemId);
          const after = projected.filter((item) => item.effectiveResourceCd === resource && !item.isCompleted);
          expect(after.filter(isNeighbour).map((item) => item.itemId)).toEqual(expected);
          expect(after.map((item) => item.alternateRank)).toEqual(after.map((_, i) => i + 1));
        }
        const overrides = await readOverrides(prisma, targetSite);
        expect(overrides.get(p.itemId)).toMatchObject({ overrideResourceCd: inheritedCutting[index].overrideResourceCd,
          overrideDueDate: inheritedCutting[index].overrideDueDate, dueDateCleared: inheritedCutting[index].dueDateCleared, orderPinned: true, version: 2 });
        expect(overrides.get(laterParentId)).toMatchObject({ overrideResourceCd: index % 2 === 0 ? '5' : '6', dueDateCleared: true, orderPinned: true, version: 2 });
        expect(result.pieces.some((item) => overrides.has(item.itemId))).toBe(false);
        expect((await prisma.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { csvDashboardId_siteKey: { csvDashboardId: dashboardId, siteKey: targetSite } } })).version).toBe(9);
      }
      expect(winnerMaterializations.count).toBe(0);
      console.info(`sessaku 4 sites / 90 seiban / ${rows.length + 2} rows`, measurements.map(({ action, full, scoped }) => ({
        // The reference still discovers lanes, but the old path did not. Exclude that new overhead.
        action, fullBeforeProjectionMs: full.beforeProjectionMs - full.laneDiscoveryMs, scopedBeforeProjectionMs: scoped.beforeProjectionMs,
        ratio: scoped.beforeProjectionMs / (full.beforeProjectionMs - full.laneDiscoveryMs), fullTiming: full, scopedTiming: scoped
      })));
      for (const { full, scoped } of measurements) {
        expect(scoped.beforeProjectionMs).toBeLessThan((full.beforeProjectionMs - full.laneDiscoveryMs) / 5);
        expect(scoped.totalMs).toBeLessThan(15000);
      }
    } finally {
      await prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: { in: sites } } });
      await prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: { in: sites.slice(2) } } });
      await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: { in: seibans } } });
      await prisma.productionScheduleSessakuPieceHistory.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: { in: seibans } } });
      await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  }, 60000);
  it.each(['', '\t \u3000'])('matches full split/resplit/merge persistence for a null lane (override=%j)', async (emptyResource) => {
    const neighbourSeiban = `NULL-${seiban}`;
    const neighbours = ['', '\t \u3000', '2'].map((resource, i) => ({
      id: randomUUID(), csvDashboardId: dashboardId, dataHash: `${site}-null-${i}`, occurredAt: new Date(),
      rowData: { ...rowData, FSEIBAN: neighbourSeiban, FHINCD: `NULL-${i}`, FSIGENCD: resource }
    }));
    const p = await parent();
    const inboundId = buildGrindingPlanningBoardRowItemId(neighbours[2].rowData);
    const project = async () => {
      const rows = await readWinnerRowsByFseibans(prisma, [seiban, neighbourSeiban]);
      return projectGrindingPlanningBoard({ rows, details: await readRowDetails(prisma, rows.map((r) => r.id)),
        overrides: await readOverrides(prisma, site), ranks: await readRanks(prisma, rows.map((r) => r.id), site),
        pieceSets: await readSessakuPieceSets(prisma, rows), seibanOrder: [neighbourSeiban, seiban],
        category: 'all', view: 'resource', includePieces: true }).items;
    };
    const snapshot = (client: Prisma.TransactionClient) => client.productionScheduleGrindingPlanningBoardOverride.findMany({
      where: { csvDashboardId: dashboardId, siteKey: { in: [site, other] } },
      select: { siteKey: true, itemKey: true, overrideResourceCd: true, overrideDueDate: true, dueDateCleared: true,
        alternateRank: true, orderPinned: true, specialDueKind: true, specialDueExpiresAt: true, version: true }
    });
    const compare = async (action: string, operation: (audit: PieceAuditContext) => Promise<SessakuPiecesMutationResponse>) => {
      const originalSource = projectionSource.readWinnerRowsByFseibans;
      const originalOverrides = projectionSource.readOverrides;
      const originalTransaction = prisma.$transaction.bind(prisma);
      const rollback = new Error('rollback null-lane full reference');
      let expected!: Awaited<ReturnType<typeof snapshot>>;
      let fullResult!: SessakuPiecesMutationResponse;
      let fullLater!: Awaited<ReturnType<typeof readSessakuPieceSet>>;
      const sourceSpy = vi.spyOn(projectionSource, 'readWinnerRowsByFseibans').mockImplementation((client, fseibans) => originalSource(client, fseibans));
      const overrideSpy = vi.spyOn(projectionSource, 'readOverrides').mockImplementation((client, targetSite) => originalOverrides(client, targetSite));
      const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<SessakuPiecesMutationResponse>, options: object) =>
        originalTransaction(async (tx) => {
          fullResult = await callback(tx); expected = await snapshot(tx);
          fullLater = await readSessakuPieceSet(tx, { ...key(), fsigencd: '2', fkojun: '2' });
          throw rollback;
        }, options).catch((error: unknown) => { if (error === rollback) return fullResult; throw error; })) as never);
      try { await runSessakuPieceOperation({ action, siteKey: site }, operation); }
      finally { transactionSpy.mockRestore(); sourceSpy.mockRestore(); overrideSpy.mockRestore(); }
      const result = await runSessakuPieceOperation({ action, siteKey: site }, operation);
      let expectedJson = JSON.stringify(expected);
      for (const piece of fullResult.pieces) {
        const actualPiece = result.pieces.find((item) => item.piecePosition === piece.piecePosition)!;
        expect(actualPiece).toBeDefined();
        expectedJson = expectedJson.replaceAll(piece.pieceId!, actualPiece.pieceId!);
      }
      const actualLater = await readSessakuPieceSet(prisma, { ...key(), fsigencd: '2', fkojun: '2' });
      for (const piece of fullLater?.pieces ?? []) {
        const actualPiece = actualLater!.pieces.find((item) => item.position === piece.position)!;
        expectedJson = expectedJson.replaceAll(piece.id, actualPiece.id);
      }
      const actual = JSON.parse(JSON.stringify(await snapshot(prisma))) as Awaited<ReturnType<typeof snapshot>>;
      const normalized = JSON.parse(expectedJson) as typeof actual;
      for (const entries of [normalized, actual]) entries.sort((a, b) => `${a.siteKey}:${a.itemKey}`.localeCompare(`${b.siteKey}:${b.itemKey}`));
      expect(actual).toEqual(normalized);
      return result;
    };
    await prisma.csvDashboardRow.createMany({ data: neighbours });
    await prisma.productionScheduleGrindingPlanningBoardState.updateMany({ where: { siteKey: { in: [site, other] } }, data: { seibanOrder: [neighbourSeiban, seiban] } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.createMany({ data: [site, other].flatMap((siteKey) => [
      { csvDashboardId: dashboardId, siteKey, itemKey: p.itemId, overrideResourceCd: emptyResource, alternateRank: 2 },
      { csvDashboardId: dashboardId, siteKey, itemKey: inboundId, overrideResourceCd: emptyResource, alternateRank: 1 }
    ]) });
    let items = await project();
    // Original empty/whitespace resources are excluded even for category=all.
    expect(items.some((item) => neighbours.slice(0, 2).some((row) => row.id === item.sourceRowId))).toBe(false);
    expect(items.filter((item) => item.effectiveResourceCd === null).map((item) => item.itemId)).toEqual([inboundId, p.itemId]);
    const current = items.find((item) => item.itemId === p.itemId)!;
    let result = await compare('split', (audit) => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId,
      itemRevision: current.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3], audit }));
    // A piece's own null override suppresses parent inheritance and falls back to original resource 1.
    await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({ where: { itemKey: result.pieces[1].itemId, siteKey: { in: [site, other] } }, data: { overrideResourceCd: null } });
    items = await project();
    expect(items.find((item) => item.itemId === result.pieces[1].itemId)?.effectiveResourceCd).toBe('1');
    const target = items.find((item) => item.itemId === result.pieces[0].itemId)!;
    expect(target.effectiveResourceCd).toBeNull();
    const version = result.pieceSetVersion;
    result = await compare('resplit', (audit) => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId,
      targetPieceId: target.pieceId!, itemRevision: target.itemRevision, expectedPieceSetVersion: version, quantities: [1, 1], audit }));
    const remaining = result.pieces;
    const mergeVersion = result.pieceSetVersion;
    await compare('merge', (audit) => mergeSessakuPieces({ siteKey: site, parentItemId: p.itemId,
      expectedPieceSetVersion: mergeVersion, pieceIds: remaining.map((item) => item.pieceId!),
      itemRevisions: Object.fromEntries(remaining.map((item) => [item.itemId, item.itemRevision])), audit }));
    const nullLane = (await project()).filter((item) => item.effectiveResourceCd === null);
    expect(nullLane.map((item) => item.itemId)).toEqual([inboundId, p.itemId]);
    expect(nullLane.map((item) => item.alternateRank)).toEqual([1, 2]);
  });
  it('keeps success and rolled-back 409 audit rows', async () => {
    const p = await parent();
    const input = { siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] };
    const result = await splitSessakuPieces(input);
    await expect(splitSessakuPieces(input)).rejects.toMatchObject({ statusCode: 409 });
    const logs = await prisma.productionScheduleSessakuPieceAuditLog.findMany({ where: { siteKey: site }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ outcome: 'success', requestedQuantities: [2, 3], timing: { siteCount: 2, upsertCount: 8, lockWaitMs: expect.any(Number), beforeProjectionMs: expect.any(Number), writeMs: expect.any(Number), afterProjectionMs: expect.any(Number), totalMs: expect.any(Number) }, resultVersion: result.pieceSetVersion, afterJson: { count: 2, quantities: [2, 3] } });
    expect(logs[0].timing).toMatchObject({ sourceWinnerMs: expect.any(Number), sourceDetailsMs: expect.any(Number), sourcePieceSetsMs: expect.any(Number),
      overridesMs: expect.any(Number), ranksMs: expect.any(Number), projectMs: expect.any(Number), laneDiscoveryMs: expect.any(Number), sourceRowCount: 2 });
    expect(logs[1]).toMatchObject({ outcome: 'rejected', requestedQuantities: [2, 3], timing: expect.objectContaining({ totalMs: expect.any(Number) }), httpStatus: 409, errorCode: 'STALE_SESSAKU_PIECES', beforeJson: { count: 2, quantities: [2, 3] }, afterJson: { count: 2, quantities: [2, 3] } });
  });
  it('gate OFF rejects creation while parent response stays unchanged', async () => {
    const before = await board(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'false');
    await expect(split()).rejects.toMatchObject({ statusCode: 403 });
    expect((await board()).items).toEqual(before.items);
    expect(await readSessakuPieceSet(prisma, key())).toBeNull();
  });
  it.each(['parent', 'piece'] as const)('returns 400 PIECE_QUANTITY_CONFLICT for a mismatched %s split total', async (target) => {
    const p = await parent();
    const result = target === 'piece' ? await split() : null;
    const item = result?.pieces[0] ?? p;
    const app = Fastify();
    registerErrorHandler(app);
    await registerSessakuPiecesRoutes(app, {
      requireClientDevice: async () => ({ clientDevice: { name: 'terminal', location: site } }),
      resolveLocationScopeContext: () => ({ siteKey: site })
    } as never);
    try {
      const response = await app.inject({ method: 'POST',
        url: '/kiosk/production-schedule/grinding-planning-board/pieces/split', headers: { 'x-client-key': 'test-client' },
        payload: { parentItemId: p.itemId, targetPieceId: item.pieceId,
          itemRevision: item.itemRevision, expectedPieceSetVersion: result?.pieceSetVersion ?? 0,
          quantities: target === 'piece' ? [2, 3] : [1, 1] }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe('PIECE_QUANTITY_CONFLICT');
      expect(await prisma.productionScheduleSessakuPieceAuditLog.findFirst({ where: { requestId: response.json().requestId, siteKey: site } })).toMatchObject({ outcome: 'rejected', httpStatus: 400, parentItemId: p.itemId, errorCode: 'PIECE_QUANTITY_CONFLICT' });
    } finally { await app.close(); }
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
  it('refreshes an empty set quantity on resplit after the order changes from 5 to 7', async () => {
    const first = await split();
    const merged = await mergeSessakuPieces({ siteKey: site, parentItemId: first.parentItemId,
      expectedPieceSetVersion: first.pieceSetVersion, pieceIds: first.pieces.map((p) => p.pieceId!),
      itemRevisions: Object.fromEntries(first.pieces.map((p) => [p.itemId, p.itemRevision])) });
    expect(merged.pieces).toEqual([]);
    await quantity(7);
    expect(await readSessakuPieceSet(prisma, key())).toMatchObject({ plannedQuantity: 5, pieces: [] });
    const p = await parent();
    const result = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId,
      itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion!, quantities: [3, 4] });
    expect(result.pieces.map((piece) => piece.quantity)).toEqual([3, 4]);
    expect(await readSessakuPieceSet(prisma, key())).toMatchObject({ plannedQuantity: 7 });
    expect(await prisma.productionScheduleSessakuPieceAuditLog.findFirst({ where: { siteKey: site, action: 'split', resultVersion: result.pieceSetVersion } })).toMatchObject({ beforeJson: { count: 0, plannedQuantity: 7 }, afterJson: { count: 2, quantities: [3, 4], plannedQuantity: 7 } });
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
  it('does not create later pieces for a row without a resource code', async () => {
    const data = { ...rowData, FSIGENCD: '', FKOJUN: '2' };
    await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: data } });
    await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '', processOrder: '2', plannedQuantity: 5 } });
    const result = await split();
    expect(result.pieces.map((piece) => piece.quantity)).toEqual([2, 3]);
    expect(await readSessakuPieceSet(prisma, sessakuPieceKeyFromRow(data))).toBeNull();
    expect(await prisma.productionScheduleSessakuPieceSet.count({ where: { csvDashboardId: dashboardId, fseiban: seiban } })).toBe(1);
  });
  it.each(['new-key', 'winner-replacement'])('retries a first split after CSV inserts a later key or winner and locks its logical key and parent row before CSV Progress sync (%s)', async (kind) => {
    const p = await parent();
    const data = { ...rowData, FSIGENCD: kind === 'new-key' ? '3' : '2', FKOJUN: kind === 'new-key' ? '3' : '2', ProductNo: '999', progress: '完了', updatedAt: '2099/01/01 00:00' };
    const laterKey = sessakuPieceKeyFromRow(data);
    let releaseFirst!: () => void, firstReady!: () => void, releaseRetry!: () => void, retryReady!: () => void, csvReady!: () => void;
    const firstHeld = new Promise<void>((resolve) => { firstReady = resolve; });
    const firstUnlock = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const retryHeld = new Promise<void>((resolve) => { retryReady = resolve; });
    const retryUnlock = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const csvAttempted = new Promise<void>((resolve) => { csvReady = resolve; });
    const transaction = prisma.$transaction.bind(prisma);
    const lockStages: string[][] = [];
    let newRowId = '';
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      const index = lockStages.length;
      const stages: string[] = []; lockStages.push(stages);
      return transaction(async (tx) => {
        const execute = tx.$executeRaw.bind(tx), query = tx.$queryRaw.bind(tx);
        const executeWithBarrier = async (...args: Parameters<typeof execute>) => {
          const sql = String(args[0]);
          if (index >= 2 && String(args[1]).startsWith('sessaku-pieces:')) csvReady();
          const result = await execute(...args);
          if (sql.includes('pg_advisory_xact_lock')) {
            stages.push(sql.includes('sessaku-piece-board-states') ? 'board' : String(args[1]).startsWith('sessaku-pieces:') ? 'logical' : typeof args[1] === 'bigint' ? 'row' : 'critical');
          }
          if (index === 0 && stages.at(-1) === 'logical') { firstReady(); await firstUnlock; }
          return result;
        };
        const queryWithBarrier = async (...args: Parameters<typeof query>) => {
          const result = await query(...args);
          if (index === 1 && String(args[0]).includes('FOR UPDATE') && args[1] === newRowId) { retryReady(); await retryUnlock; }
          return result;
        };
        return callback(new Proxy(tx, { get: (target, property) => property === '$executeRaw' ? executeWithBarrier : property === '$queryRaw' ? queryWithBarrier : Reflect.get(target, property) }));
      }, options);
    }) as typeof prisma.$transaction);
    const pending = splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] });
    let csvPending: Promise<void> | undefined;
    try {
      await firstHeld;
      // Raw CSV publication uses another connection and precedes its Progress synchronization.
      const row = await reader.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: data, dataHash: `${site}-inserted-later`, occurredAt: new Date() } });
      newRowId = row.id;
      await reader.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: row.id, sourceCsvDashboardId: site, productNo: data.ProductNo, resourceCd: data.FSIGENCD, processOrder: data.FKOJUN, plannedQuantity: 5 } });
      releaseFirst();
      expect(await Promise.race([retryHeld.then(() => 'retry'), pending.then(() => 'finished')])).toBe('retry');
      for (const stages of lockStages.slice(0, 2)) {
        expect(stages.slice(0, 3)).toEqual(['critical', 'logical', 'board']);
        expect(stages.slice(3).every((stage) => stage === 'row')).toBe(true);
      }
      const logicalLock = `sessaku-pieces:${dashboardId}:${encodeSessakuPieceKey(laterKey)}`;
      const parentLock = createHash('sha256').update(row.id).digest().readBigInt64BE(0);
      await reader.$transaction(async (tx) => {
        expect(await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${logicalLock}, 0)) AS locked`).toEqual([{ locked: false }]);
        expect(await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${parentLock}) AS locked`).toEqual([{ locked: false }]);
      });
      await expect(reader.$transaction((tx) => tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${row.id} FOR UPDATE NOWAIT`)).rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } });
      csvPending = new ProgressSyncFromCsvService().sync({ candidates: [{ rowId: row.id, rowData: row.rowData, occurredAt: row.occurredAt }] });
      await csvAttempted;
      releaseRetry();
      const result = await pending;
      await csvPending;
      const saved = await readSessakuPieceSet(prisma, laterKey);
      expect(saved?.sourcePieceSetId).toBe((await readSessakuPieceSet(prisma, key()))?.id);
      expect(saved?.pieces.map((piece) => [piece.sourcePieceId, piece.quantity, piece.position, piece.isCompleted])).toEqual(result.pieces.map((piece) => [piece.pieceId, piece.quantity, piece.piecePosition, false]));
      expect(await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: row.id } })).toMatchObject({ isCompleted: false });
    } finally {
      releaseFirst(); releaseRetry();
      await Promise.allSettled([pending, ...(csvPending ? [csvPending] : [])]);
      spy.mockRestore();
    }
  });
  it('returns a conflict without piece or board writes when later keys keep appearing on every lock attempt', async () => {
    const p = await parent();
    const before = await prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { siteKey: { in: [site, other] } } });
    const transaction = prisma.$transaction.bind(prisma);
    let attempts = 0;
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
      const index = ++attempts;
      return transaction(async (tx) => {
        const execute = tx.$executeRaw.bind(tx);
        const executeWithNewKey = async (...args: Parameters<typeof execute>) => {
          const result = await execute(...args);
          if (String(args[1]).startsWith('sessaku-pieces:')) {
            await reader.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FSIGENCD: '3', FKOJUN: String(index + 2) }, dataHash: `${site}-new-key-${index}`, occurredAt: new Date() } });
          }
          return result;
        };
        return callback(new Proxy(tx, { get: (target, property) => property === '$executeRaw' ? executeWithNewKey : Reflect.get(target, property) }));
      }, options);
    }) as typeof prisma.$transaction);
    try {
      await expect(splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_SESSAKU_PIECES' });
      expect(attempts).toBe(3);
      expect(await prisma.productionScheduleSessakuPieceSet.count({ where: { csvDashboardId: dashboardId, fseiban: seiban } })).toBe(0);
      expect(await prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { siteKey: { in: [site, other] } } })).toEqual(before);
      expect(await prisma.productionScheduleProgress.count({ where: { csvDashboardRow: { dataHash: { startsWith: site } } } })).toBe(0);
    } finally { spy.mockRestore(); }
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
    const resplit = (r: Awaited<ReturnType<typeof splitThree>>, index = 1) => splitSessakuPieces({ siteKey: site, parentItemId: r.parentItemId, targetPieceId: r.pieces[index].pieceId, itemRevision: r.pieces[index].itemRevision, expectedPieceSetVersion: r.pieceSetVersion, quantities: [1, 1] });
    it.each(['split', 'merge'].flatMap((action) => [false, true].map((linked) => ({ action, linked }))))(
      'checks only affected downstream operations for $action (linked=$linked)', async ({ action, linked }) => {
        await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '2', fhincd: 'PART-A', perUnitMinutes: 3,
          setupMinutes: 0, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
        const result = await splitThree();
        const sourceId = result.pieces[linked ? 1 : 0].pieceId!;
        const downstream = (await laterItems()).find((piece) => piece.sourcePieceId === sourceId)!;
        await setSessakuPieceOpCompletion({ siteKey: site, pieceId: downstream.pieceId!, opNo: 1, intent: 'complete',
          expectedPieceSetVersion: downstream.pieceSetVersion!, itemRevision: downstream.itemRevision });
        const pieces = (await board()).items.filter((piece) => piece.sourceRowId === rowId);
        const current = { ...result, pieces, pieceSetVersion: pieces[0].pieceSetVersion! };
        const operation = action === 'split' ? resplit(current, 1) : merge(current, pieces.slice(1));
        if (linked) await expect(operation).rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
        else {
          await operation;
          expect((await laterItems()).find((piece) => piece.pieceId === downstream.pieceId))
            .toMatchObject({ sourcePieceId: sourceId, isCompleted: false });
        }
        expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: downstream.pieceId! }, select: { opNo: true } }))
          .toEqual([{ opNo: 1 }]);
      });
    it('refuses to merge every piece while an unlinked downstream piece has partial operations', async () => {
      await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: site, resourceCd: '2', fhincd: 'PART-A', perUnitMinutes: 3,
        setupMinutes: 0, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] });
      const result = await splitThree();
      const downstream = (await laterItems()).find((piece) => piece.sourcePieceId === result.pieces[0].pieceId)!;
      await setSessakuPieceOpCompletion({ siteKey: site, pieceId: downstream.pieceId!, opNo: 1, intent: 'complete',
        expectedPieceSetVersion: downstream.pieceSetVersion!, itemRevision: downstream.itemRevision });
      await prisma.productionScheduleSessakuPiece.update({ where: { id: downstream.pieceId! }, data: { sourcePieceId: null } });
      const pieces = (await board()).items.filter((piece) => piece.sourceRowId === rowId);
      await expect(merge({ ...result, pieces, pieceSetVersion: pieces[0].pieceSetVersion! }))
        .rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
      expect(await prisma.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: downstream.pieceId! }, select: { opNo: true } }))
        .toEqual([{ opNo: 1 }]);
    });
    const laterQuantity = async (total: number | null) => {
      await reader.$transaction(async (tx) => {
        const keys = await lockSessakuPieceSourceRows(tx, [nextRowId]);
        await tx.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: total } });
        await synchronizeSessakuPieceSources(tx, keys);
      });
    };
    const importLaterQuantity = async (raw: string, productNo = '123') => {
      const source = toSupplementNormalizedRow('source', { ProductNo: productNo, FSIGENCD: '2', FKOJUN: '2', plannedQuantity: raw })!;
      const supplement = await prisma.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: nextRowId } });
      const lookup = buildOrderSupplementKey(source);
      const plan = buildReplacementCreateInputs([source], new Map([[lookup, nextRowId]]), new Map(supplement ? [[lookup, supplement]] : []), new Date());
      await runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: 1, normalized: 1 });
      return source;
    };
    const createCuttingRow = async (order: string) => {
      const data = { ...rowData, FKOJUN: order };
      const row = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: data, dataHash: `${site}-cutting-${order}`, occurredAt: new Date() } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: row.id, sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: order, plannedQuantity: 5 } });
      return { id: row.id, key: sessakuPieceKeyFromRow(data) };
    };
    const splitRow = async (id: string) => {
      const p = (await board(false)).items.find((item) => item.sourceRowId === id)!;
      return splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [1, 2, 2] });
    };
    const importRowQuantities = async (ids: string[], raw: string) => {
      const rows = await prisma.csvDashboardRow.findMany({ where: { id: { in: ids } } });
      const sources = rows.map((row) => {
        const data = row.rowData as Record<string, string>;
        return { id: row.id, source: toSupplementNormalizedRow('source', { ...data, plannedQuantity: raw })! };
      });
      const supplements = await prisma.productionScheduleOrderSupplement.findMany({ where: { csvDashboardRowId: { in: ids } } });
      const plan = buildReplacementCreateInputs(sources.map(({ source }) => source),
        new Map(sources.map(({ id, source }) => [buildOrderSupplementKey(source), id])),
        new Map(supplements.map((supplement) => [buildOrderSupplementKey(supplement), supplement])), new Date());
      await runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: ids.length, normalized: ids.length });
    };
    it.each(['later', 'cutting'])('rejects completion of the old winner of an empty %s set before quantity restoration', async (kind) => {
      await splitThree();
      if (kind === 'later') await laterQuantity(0); else await quantity(0);
      const targetKey = kind === 'later' ? laterKey() : key();
      const previousId = kind === 'later' ? nextRowId : rowId;
      const before = (await readSessakuPieceSet(prisma, targetKey))!;
      expect(before.pieces).toEqual([]);
      expect(Boolean(before.sourcePieceSetId)).toBe(kind === 'later');
      const replacementId = await reader.$transaction(async (tx) => {
        await acquireSessakuPieceLogicalLocks(tx, [targetKey]);
        const states = await readSessakuPiecePublicationState(tx, [targetKey]);
        const previous = await tx.csvDashboardRow.findUniqueOrThrow({ where: { id: previousId } });
        const replacement = await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...previous.rowData as Prisma.InputJsonObject, ProductNo: '999' }, dataHash: `${site}-replacement`, occurredAt: new Date() } });
        await tx.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: replacement.id, sourceCsvDashboardId: site, productNo: '999', resourceCd: targetKey.fsigencd, processOrder: targetKey.fkojun, plannedQuantity: 0 } });
        await publishSessakuPieceProgress(tx, states);
        return replacement.id;
      });
      expect((await findSessakuPieceWinner(prisma, targetKey))?.id).toBe(replacementId);
      const oldProgress = await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: previousId } });
      const newProgress = await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: replacementId } });
      for (const drive of [{ mode: 'intent', intent: 'complete' }, { mode: 'toggle' }] as const) {
        await expect(driveProductionScheduleRowCompletion({ rowId: previousId, locationKey: site, drive })).rejects.toMatchObject({ statusCode: 409, code: 'SOURCE_ITEM_MISSING' });
      }
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: previousId } })).toEqual(oldProgress);
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: replacementId } })).toEqual(newProgress);
      if (kind === 'later') { nextRowId = replacementId; await laterQuantity(5); }
      else { rowId = replacementId; await quantity(5); await splitThree(); }
      const restored = (await readSessakuPieceSet(prisma, targetKey))!;
      expect(restored.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
      expect(restored.pieces.every((piece) => !piece.isCompleted && piece.completedAt === null)).toBe(true);
      expect((await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: replacementId } }))?.isCompleted).not.toBe(true);
    });
    it.each(['２', '０１０'])('discovers and links full-width later order %s during operate', async (fkojun) => {
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '2', FKOJUN: fkojun } } });
      const r = await splitThree();
      const source = (await readSessakuPieceSet(prisma, key()))!;
      const later = (await readSessakuPieceSet(prisma, { ...laterKey(), fkojun }))!;
      expect(later.sourcePieceSetId).toBe(source.id);
      expect(later.pieces.map(({ sourcePieceId, quantity, position }) => [sourcePieceId, quantity, position]))
        .toEqual(r.pieces.map((piece) => [piece.pieceId, piece.quantity, piece.piecePosition]));
    });
    it.each(['split', 'merge'])('increments a winnerless later set version when %s removes only some source links', async (operation) => {
      const r = await splitThree();
      const before = (await readSessakuPieceSet(prisma, laterKey()))!;
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      if (operation === 'split') await resplit(r);
      else await merge(r, r.pieces.slice(1));
      const after = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(after.sourcePieceSetId).toBe(before.sourcePieceSetId);
      expect(after.pieces.length).toBeLessThan(before.pieces.length);
      expect(after.pieces[0]).toEqual(before.pieces[0]);
      expect(after.version).toBe(before.version + 1);
    });
    it.each([
      { operation: 'zero', supplement: null, external: false, expected: false },
      { operation: 'full-merge', supplement: null, external: false, expected: false },
      { operation: 'full-merge', supplement: 3, external: false, expected: false },
      { operation: 'full-merge', supplement: 2, external: false, expected: true },
      { operation: 'full-merge', supplement: 3, external: true, expected: true }
    ])('publishes returning detached completed evidence safely ($operation, supplement=$supplement, external=$external)', async ({ operation, supplement, external, expected }) => {
      await quantity(3); await laterQuantity(3);
      const p = await parent();
      const r = await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 2] });
      await complete((await laterItems())[1]);
      const oldRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      if (operation === 'zero') await quantity(0); else await merge(r);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ plannedQuantity: 3, pieces: [{ quantity: 2, sourcePieceId: null, isCompleted: true }] });
      const eventsBefore = await prisma.dueManagementOutcomeEvent.count({ where: { fseiban: seiban } });
      const returningId = randomUUID();
      // Place an assignment immediately after the CSV row is created, before publication reconciles Progress.
      // All writes still use the real transaction and database.
      const transaction = prisma.$transaction.bind(prisma);
      const publishTransaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => transaction(async (tx) => {
        const create = tx.csvDashboardRow.create.bind(tx.csvDashboardRow);
        const createWithAssignment = async (args: Parameters<typeof create>[0]) => {
          const created = await create(args);
          await tx.productionScheduleOrderAssignment.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: returningId, siteKey: site, location: site, resourceCd: '2', orderNumber: 1 } });
          if (supplement !== null) await tx.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: returningId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: supplement } });
          if (external) await tx.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: returningId, isExternallyCompleted: true } });
          return created;
        };
        return callback(new Proxy(tx, { get: (target, property) => property === 'csvDashboardRow' ? new Proxy(tx.csvDashboardRow, { get: (model, name) => name === 'create' ? createWithAssignment : Reflect.get(model, name) }) : Reflect.get(target, property) }));
      }, options)) as typeof prisma.$transaction;
      const publicationClient = new Proxy(prisma, { get: (target, property) => property === '$transaction' ? publishTransaction : Reflect.get(target, property) });
      await publishSessakuPieceSourceCreates(publicationClient, [{ id: returningId, csvDashboardId: dashboardId, rowData: oldRow.rowData!, occurredAt: new Date(), dataHash: `${site}-returned` }]);
      nextRowId = returningId;
      expect((await findSessakuPieceWinner(prisma, laterKey()))?.id).toBe(returningId);
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: returningId } })).toMatchObject({ isCompleted: expected });
      expect(await prisma.productionScheduleOrderAssignment.count({ where: { csvDashboardRowId: returningId, location: site } })).toBe(expected ? 0 : 1);
      expect(await prisma.dueManagementOutcomeEvent.count({ where: { fseiban: seiban } })).toBe(eventsBefore + Number(expected));
      if (!expected) {
        if (supplement === null) await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: returningId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 3 } });
        await laterQuantity(3);
        expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [{ quantity: 2, isCompleted: true }, { quantity: 1, isCompleted: false }] });
        expect(await prisma.productionScheduleOrderAssignment.count({ where: { csvDashboardRowId: returningId, location: site } })).toBe(1);
        expect(await prisma.dueManagementOutcomeEvent.count({ where: { fseiban: seiban } })).toBe(eventsBefore);
      }
    });
    it.each([false, true])('replaces every detached later piece and clears overrides on full merge (cancelled completion=%s)', async (cancelled) => {
      let r = await splitThree();
      if (cancelled) {
        await complete((await laterItems())[2]);
        const oldRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
        await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
        r = await resplit(r, 2);
        [nextRowId] = (await publishSessakuPieceSourceCreates(prisma, [{ csvDashboardId: dashboardId, rowData: oldRow.rowData!, occurredAt: new Date(), dataHash: `${site}-returned` }])).map((row) => row.rowId);
        await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 2 } });
        await laterQuantity(2);
        await complete((await laterItems())[0], 'incomplete');
      } else {
        const later = (await readSessakuPieceSet(prisma, laterKey()))!;
        await prisma.productionScheduleSessakuPiece.updateMany({ where: { pieceSetId: later.id }, data: { sourcePieceId: null } });
        await laterQuantity(5);
      }
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(later.pieces.length).toBeGreaterThan(0);
      expect(later.pieces.every((piece) => piece.sourcePieceId === null && !piece.isCompleted)).toBe(true);
      const parentId = buildGrindingPlanningBoardRowItemId({ ...rowData, FSIGENCD: '2', FKOJUN: '2' });
      for (const [siteKey, resource] of [[site, '581'], [other, '582']]) {
        await prisma.productionScheduleGrindingPlanningBoardOverride.upsert({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey, itemKey: parentId } }, create: { csvDashboardId: dashboardId, siteKey, itemKey: parentId, overrideResourceCd: '580' }, update: { overrideResourceCd: '580' } });
        for (const piece of later.pieces) await prisma.productionScheduleGrindingPlanningBoardOverride.upsert({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey, itemKey: `piece:${piece.id}` } }, create: { csvDashboardId: dashboardId, siteKey, itemKey: `piece:${piece.id}`, overrideResourceCd: resource, alternateRank: piece.position, orderPinned: true }, update: { overrideResourceCd: resource, alternateRank: piece.position, orderPinned: true } });
      }
      await merge(r);
      expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.count({ where: { itemKey: { in: later.pieces.map((piece) => `piece:${piece.id}`) } } })).toBe(0);
      for (const [siteKey, resource] of [[site, '581'], [other, '582']]) {
        expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findUnique({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey, itemKey: parentId } } })).toMatchObject({ overrideResourceCd: resource, orderPinned: true, alternateRank: 1 });
        expect((await allBoard(siteKey)).items.find((item) => item.sourceRowId === nextRowId)).toMatchObject({ kind: 'row', effectiveResourceCd: resource });
      }
    });
    it('does not propagate cutting order 010 to the numerically equal order 10', async () => {
      rowData = { ...rowData, FKOJUN: '010' };
      await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData } });
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '2', FKOJUN: '10' } } });
      const result = await splitThree();
      expect(result.pieces).toHaveLength(3);
      expect(await readSessakuPieceSet(prisma, { ...key(), fsigencd: '2', fkojun: '10' })).toBeNull();
      expect(await laterItems()).toMatchObject([{ kind: 'row', plannedQuantity: 5 }]);
    });
    it.each(['direct', 'adopted'].flatMap((path) => ['split', 'merge'].map((operation) => ({ path, operation }))))('detaches a winnerless empty later set once during $operation ($path link)', async ({ path, operation }) => {
      const cutting = await splitThree();
      await laterQuantity(0);
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(later).toMatchObject({ sourcePieceSetId: (await readSessakuPieceSet(prisma, key()))!.id, pieces: [] });
      let adoptedId: string | undefined;
      if (path === 'adopted') {
        const intermediate = await createCuttingRow('1.5');
        const empty = await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...intermediate.key, plannedQuantity: 0 } });
        adoptedId = empty.id;
        await prisma.productionScheduleSessakuPieceSet.update({ where: { id: later.id }, data: { sourcePieceSetId: empty.id } });
      }
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      const result = operation === 'split' ? await resplit(cutting) : await merge(cutting, cutting.pieces.slice(1));
      const detached = await readSessakuPieceSet(prisma, laterKey());
      expect(detached).toMatchObject({ id: later.id, sourcePieceSetId: null, quantityWarning: null, version: later.version + 1, pieces: [] });
      if (adoptedId) expect(await prisma.productionScheduleSessakuPieceSet.findUniqueOrThrow({ where: { id: adoptedId } })).toMatchObject({ sourcePieceSetId: (await readSessakuPieceSet(prisma, key()))!.id });
      const merged = await merge(result);
      expect(merged.pieces).toEqual([]);
      expect(await readSessakuPieceSet(prisma, laterKey())).toEqual(detached);
      if (adoptedId) expect(await prisma.productionScheduleSessakuPieceSet.findUnique({ where: { id: adoptedId } })).toBeNull();
    });
    it.each([false, true])('adopts an empty cutting set with a missing later winner and fully merges (completed evidence=%s)', async (completed) => {
      const a = await createCuttingRow('0');
      await splitThree();
      if (completed) await complete((await laterItems())[2]);
      const c = (await readSessakuPieceSet(prisma, laterKey()))!;
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      await quantity(0);
      expect((await readSessakuPieceSet(prisma, key()))?.pieces).toEqual([]);
      const beforeAdoption = (await readSessakuPieceSet(prisma, laterKey()))!;
      const r = await splitRow(a.id);
      const source = (await readSessakuPieceSet(prisma, a.key))!;
      expect((await readSessakuPieceSet(prisma, key()))?.sourcePieceSetId).toBe(source.id);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ sourcePieceSetId: null, version: beforeAdoption.version + 1,
        pieces: completed ? [{ id: c.pieces[2].id, sourcePieceId: null, isCompleted: true, quantity: 2 }] : [] });
      await merge(r);
      expect(await readSessakuPieceSet(prisma, key())).toBeNull();
      const retained = await readSessakuPieceSet(prisma, laterKey());
      if (completed) expect(retained).toMatchObject({ sourcePieceSetId: null, quantityWarning: null,
        pieces: [{ id: c.pieces[2].id, sourcePieceId: null, isCompleted: true, quantity: 2, completedAt: c.pieces[2].completedAt }] });
      else expect(retained).toMatchObject({ sourcePieceSetId: null, version: beforeAdoption.version + 1, pieces: [] });
    });
    it.each([false, true])('adopts an empty cutting set during partial merge with direct links (noncontiguous=%s)', async (noncontiguous) => {
      const a = await createCuttingRow('0');
      await splitThree();
      await importRowQuantities([rowId, nextRowId], '0');
      // A first skips completed, empty B and its already-owned C (a known limitation).
      await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
      const r = await splitRow(a.id);
      expect((await readSessakuPieceSet(prisma, key()))?.sourcePieceSetId).toBeNull();
      await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'incomplete' });
      const merged = await merge(r, [r.pieces[0], r.pieces[noncontiguous ? 2 : 1]]);
      expect(merged.pieces).toHaveLength(2);
      const source = (await readSessakuPieceSet(prisma, a.key))!;
      for (const target of [key(), laterKey()]) expect(await readSessakuPieceSet(prisma, target)).toMatchObject({ sourcePieceSetId: source.id, pieces: [] });
      await importRowQuantities([rowId, nextRowId], '5');
      for (const target of [key(), laterKey()]) {
        const saved = (await readSessakuPieceSet(prisma, target))!;
        expect(saved.sourcePieceSetId).toBe(source.id);
        expect(saved.pieces.map(({ sourcePieceId, quantity, position }) => ({ sourcePieceId, quantity, position })))
          .toEqual(source.pieces.map(({ id, quantity, position }) => ({ sourcePieceId: id, quantity, position })));
      }
      await merge(merged);
      for (const target of [key(), laterKey()]) expect(await readSessakuPieceSet(prisma, target)).toBeNull();
    });
    it('flattens two consecutive empty cutting sets before restoring quantities and fully merging', async () => {
      const a = await createCuttingRow('0');
      const c = await createCuttingRow('2');
      const grindingData = { ...rowData, FSIGENCD: '2', FKOJUN: '3' };
      const grindingKey = sessakuPieceKeyFromRow(grindingData);
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: grindingData } });
      await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { processOrder: '3' } });
      await splitRow(c.id);
      await importRowQuantities([c.id, nextRowId], '0');
      await splitThree();
      await importRowQuantities([rowId], '0');
      const b = (await readSessakuPieceSet(prisma, key()))!;
      expect(b).toMatchObject({ sourcePieceSetId: null, pieces: [] });
      for (const target of [c.key, grindingKey]) expect(await readSessakuPieceSet(prisma, target)).toMatchObject({ sourcePieceSetId: b.id, pieces: [] });
      const r = await splitRow(a.id);
      const source = (await readSessakuPieceSet(prisma, a.key))!;
      for (const target of [key(), c.key, grindingKey]) expect(await readSessakuPieceSet(prisma, target)).toMatchObject({ sourcePieceSetId: source.id, pieces: [] });
      await importRowQuantities([rowId, c.id, nextRowId], '5');
      for (const target of [key(), c.key, grindingKey]) {
        const saved = (await readSessakuPieceSet(prisma, target))!;
        expect(saved.sourcePieceSetId).toBe(source.id);
        expect(saved.pieces.map(({ sourcePieceId, quantity, position }) => ({ sourcePieceId, quantity, position })))
          .toEqual(source.pieces.map(({ id, quantity, position }) => ({ sourcePieceId: id, quantity, position })));
      }
      await merge(r);
      for (const target of [key(), c.key, grindingKey]) expect(await readSessakuPieceSet(prisma, target)).toBeNull();
    });
    it('preserves detached unfinished IDs, positions, quantities and overrides on repeated quantity sync', async () => {
      await quantity(3); await laterQuantity(3);
      const p = await parent();
      await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 2] });
      await complete((await laterItems())[1]);
      const oldRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      await quantity(0);
      expect((await readSessakuPieceSet(prisma, key()))?.pieces).toEqual([]);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toMatchObject([{ quantity: 2, isCompleted: true, sourcePieceId: null }]);
      nextRowId = (await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: oldRow.rowData!, occurredAt: new Date(), dataHash: `${site}-returned` } })).id;
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 3 } });
      await laterQuantity(3);
      const saved = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(saved.pieces).toMatchObject([{ quantity: 2, sourcePieceId: null, isCompleted: true }, { quantity: 1, sourcePieceId: null, isCompleted: false }]);
      const itemKey = `piece:${saved.pieces[1].id}`;
      await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey, overrideResourceCd: '581', alternateRank: 7, orderPinned: true } });
      const overrides = await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site, itemKey } });
      for (let i = 0; i < 2; i++) {
        await laterQuantity(3);
        expect(await readSessakuPieceSet(prisma, laterKey())).toEqual(saved);
        expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site, itemKey } })).toEqual(overrides);
      }
    });
    it('inherits manual completion when CSV updates the winner of an empty linked set without cutting rows', async () => {
      seiban = seiban.slice(0, 8);
      rowData = { ...rowData, FSEIBAN: seiban };
      await prisma.csvDashboardRow.update({ where: { id: rowId }, data: { rowData } });
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '2', FKOJUN: '2' } } });
      await prisma.productionScheduleGrindingPlanningBoardState.updateMany({ where: { siteKey: { in: [site, other] } }, data: { seibanOrder: [seiban] } });
      await splitThree(); await laterQuantity(0);
      await setProductionScheduleRowCompletionIntent({ rowId: nextRowId, locationKey: site, intent: 'complete' });
      const savedDashboard = await prisma.csvDashboard.findUniqueOrThrow({ where: { id: dashboardId } });
      const previousRowId = nextRowId;
      const incoming = { ...rowData, FSIGENCD: '2', FKOJUN: '2', ProductNo: '0000000124' };
      const candidate = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...incoming, ProductNo: '122' }, dataHash: calculateProductionScheduleDataHash(incoming), occurredAt: new Date() } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: candidate.id, sourceCsvDashboardId: site, productNo: incoming.ProductNo, resourceCd: '2', processOrder: '2', plannedQuantity: 0 } });
      expect((await findSessakuPieceWinner(prisma, laterKey()))?.id).toBe(previousRowId);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [], sourcePieceSetId: expect.any(String) });
      const columns = Object.keys(incoming);
      try {
        await prisma.csvDashboard.update({ where: { id: dashboardId }, data: { enabled: true, ingestMode: 'DEDUP', dateColumnName: null, dedupKeyColumns: [...PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS], columnDefinitions: columns.map((name) => ({ internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string' })) } });
        await new CsvDashboardIngestor().ingestFromGmail(dashboardId, `${columns.join(',')}\n${Object.values(incoming).join(',')}\n`, undefined, site);
        nextRowId = candidate.id;
        expect((await findSessakuPieceWinner(prisma, laterKey()))?.id).toBe(nextRowId);
        expect(await prisma.csvDashboardRow.findUnique({ where: { id: previousRowId } })).toBeNull();
        expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: nextRowId } })).toMatchObject({ isCompleted: true });
        expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [], sourcePieceSetId: expect.any(String) });
      } finally {
        await prisma.csvDashboardRow.deleteMany({ where: { id: candidate.id } });
        await prisma.csvDashboardIngestRun.deleteMany({ where: { messageSubject: site } });
        await prisma.csvDashboard.update({ where: { id: dashboardId }, data: { enabled: savedDashboard.enabled, ingestMode: savedDashboard.ingestMode, dateColumnName: savedDashboard.dateColumnName, dedupKeyColumns: savedDashboard.dedupKeyColumns, columnDefinitions: savedDashboard.columnDefinitions as Prisma.InputJsonValue } });
      }
    });
    it.each([false, true])('shrinks cutting with an orphaned later reference (completed=%s)', async (completed) => {
      await splitThree();
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      const reference = later.pieces[2];
      if (completed) await prisma.productionScheduleSessakuPiece.update({ where: { id: reference.id }, data: { isCompleted: true, completedAt: new Date() } });
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      await quantity(2);
      expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1]);
      expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: cutting.pieces[2].id } })).toBeNull();
      const retained = await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: reference.id } });
      if (completed) expect(retained).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true, completedAt: expect.any(Date) });
      else expect(retained).toBeNull();
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.slice(0, 2)).toEqual(later.pieces.slice(0, 2));
      await quantity(2); // A repeated import must not be stuck on the FK again.
    });
    it.each(['split', 'merge'])('retains detached identity, quantity and placement after cancellation when the later winner returns (%s)', async (operation) => {
      const r = await splitThree();
      await complete((await laterItems())[2]);
      const done = (await readSessakuPieceSet(prisma, laterKey()))!.pieces[2];
      const itemKey = `piece:${done.id}`;
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({ where: { csvDashboardId: dashboardId, siteKey: site, itemKey }, data: { overrideResourceCd: '581', alternateRank: 7, orderPinned: true } })).toMatchObject({ count: 1 });
      const overrides = await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site, itemKey } });
      const oldRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      if (operation === 'split') await resplit(r, 2);
      else await merge(r, r.pieces.slice(1));
      const hidden = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(hidden.sourcePieceSetId).not.toBeNull();
      expect(hidden.pieces.some((piece) => piece.sourcePieceId !== null)).toBe(true);
      expect(hidden.pieces.find((piece) => piece.id === done.id)).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true });
      nextRowId = (await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: oldRow.rowData!, occurredAt: new Date(), dataHash: `${site}-returned` } })).id;
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 5 } });
      await laterQuantity(5);
      await complete((await laterItems()).find((piece) => piece.pieceId === done.id)!, 'incomplete');
      const cancelled = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(cancelled.pieces.find((piece) => piece.id === done.id)).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: false, completedAt: null });
      expect(cancelled.pieces.reduce((sum, piece) => sum + piece.quantity, 0)).toBe(5);
      expect(cancelled.quantityWarning).toBeNull();
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site, itemKey } })).toEqual(overrides);
      await laterQuantity(5);
      expect(await readSessakuPieceSet(prisma, laterKey())).toEqual(cancelled);
      await complete((await laterItems()).find((piece) => piece.pieceId === done.id)!);
      const completed = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(completed.pieces.find((piece) => piece.id === done.id)).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true, completedAt: expect.any(Date) });
      expect(completed.pieces.reduce((sum, piece) => sum + piece.quantity, 0)).toBe(5);
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site, itemKey } })).toEqual(overrides);
    });
    it.each(['cutting', 'later'])('retains detached completed quantities when the later winner returns (%s sync)', async (direction) => {
      await splitThree();
      await complete((await laterItems())[2]);
      const done = (await readSessakuPieceSet(prisma, laterKey()))!.pieces[2];
      const oldRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      await quantity(2);
      expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: done.id } })).toMatchObject({ sourcePieceId: null, isCompleted: true, quantity: 2 });
      nextRowId = (await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: oldRow.rowData!, occurredAt: new Date(), dataHash: `${site}-returned` } })).id;
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, sourceCsvDashboardId: site, productNo: '123', resourceCd: '2', processOrder: '2', plannedQuantity: 5 } });
      if (direction === 'cutting') await quantity(5); else await laterQuantity(5);
      const saved = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(saved.pieces.find((piece) => piece.id === done.id)).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true, completedAt: done.completedAt });
      expect(saved.pieces.reduce((sum, piece) => sum + piece.quantity, 0)).toBe(5);
      expect(saved.pieces.filter((piece) => !piece.isCompleted).reduce((sum, piece) => sum + piece.quantity, 0)).toBe(3);
      await laterQuantity(1);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
      expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: done.id } })).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true });
    });
    it.each(['split', 'merge', 'full-merge'].flatMap((operation) => [false, true].map((completed) => ({ operation, completed }))))('allows cutting $operation after the later winner disappears (completed=$completed)', async ({ operation, completed }) => {
      const r = await splitThree();
      if (completed) await complete((await laterItems())[2]);
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      const done = later.pieces[2];
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      if (operation === 'split') await resplit(r, 2);
      else await merge(r, operation === 'merge' ? r.pieces.slice(1) : r.pieces);
      const retained = await readSessakuPieceSet(prisma, laterKey());
      const audit = await prisma.productionScheduleSessakuPieceAuditLog.findFirstOrThrow({ where: { fseiban: seiban, action: operation === 'split' ? 'split' : 'merge' }, orderBy: { createdAt: 'desc' } });
      expect(audit.afterJson).toMatchObject({ laterProcesses: retained ? [{ setId: later.id, pieces: retained.pieces.map(({ id, sourcePieceId, quantity, isCompleted }) => ({ id, sourcePieceId, quantity, isCompleted })) }] : [] });
      if (completed) expect(audit.afterJson).toMatchObject({ laterProcesses: [{ setId: later.id, pieces: expect.arrayContaining([{ id: done.id, sourcePieceId: null, quantity: done.quantity, isCompleted: true }]) }] });
      if (operation === 'full-merge') {
        const retained = await readSessakuPieceSet(prisma, laterKey());
        if (completed) expect(retained).toMatchObject({ sourcePieceSetId: null, quantityWarning: null, pieces: [{ id: done.id, sourcePieceId: null, quantity: 2, isCompleted: true, completedAt: done.completedAt }] });
        else expect(retained).toBeNull();
      } else {
        if (completed) {
          expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: done.id } })).toMatchObject({ sourcePieceId: null, quantity: 2, isCompleted: true, completedAt: done.completedAt });
        } else expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: done.id } })).toBeNull();
        const cutting = (await readSessakuPieceSet(prisma, key()))!;
        const items = (await board()).items.filter((item) => item.sourceRowId === rowId);
        // Removing the final old source detaches the hidden set without recreating pieces.
        const current = { ...r, pieces: items, pieceSetVersion: cutting.version };
        if (operation === 'split') await merge(current, items.slice(0, 2));
        if (operation === 'split') expect((await readSessakuPieceSet(prisma, laterKey()))?.sourcePieceSetId).toBeNull();
      }
    });
    it.each(['split', 'merge'])('allows cutting %s after an externally completed, warned later winner disappears', async (operation) => {
      const r = await splitThree();
      await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, isExternallyCompleted: true } });
      await importLaterQuantity('2');
      expect((await readSessakuPieceSet(prisma, laterKey()))?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      const result = operation === 'split' ? await resplit(r) : await merge(r);
      if (operation === 'split') await merge(result);
      expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
    });
    it('clears the warning when removing the final source references from a hidden set with completed evidence', async () => {
      const r = await splitThree();
      await complete((await laterItems())[2]);
      await importLaterQuantity('1');
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      await merge(r);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ sourcePieceSetId: null, quantityWarning: null, pieces: [{ quantity: 2, isCompleted: true, sourcePieceId: null }] });
    });
    it.each(['cutting', 'later'])('keeps quantity growth aligned with each source (%s plan updated first)', async (first) => {
      let r = await split();
      r = await complete(r.pieces[1]);
      await complete((await laterItems())[0]);
      const done = (await readSessakuPieceSet(prisma, laterKey()))!.pieces[0];
      if (first === 'cutting') { await quantity(6); await laterQuantity(6); }
      else { await laterQuantity(6); await quantity(6); }
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(cutting.pieces.map((piece) => piece.quantity)).toEqual([3, 3]);
      expect(later.pieces.map((piece) => [piece.sourcePieceId, piece.quantity, piece.isCompleted])).toEqual([
        [cutting.pieces[0].id, 2, true], [cutting.pieces[0].id, 1, false], [cutting.pieces[1].id, 3, false]
      ]);
      expect(later.pieces[0].completedAt).toEqual(done.completedAt);
      expect(later.quantityWarning).toBeNull();
    });
    it('counts detached completed later quantity when protecting a cutting decrease', async () => {
      const p = await parent();
      await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 4] });
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      await prisma.productionScheduleSessakuPiece.update({ where: { id: later.pieces[1].id }, data: { quantity: 2 } });
      const done = await prisma.productionScheduleSessakuPiece.create({ data: { pieceSetId: later.id, position: 3, quantity: 2, isCompleted: true, completedAt: new Date() } });
      await quantity(1);
      expect(await readSessakuPieceSet(prisma, key())).toMatchObject({ pieces: cutting.pieces, quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN' });
      expect(await prisma.productionScheduleSessakuPiece.findUnique({ where: { id: done.id } })).toEqual(done);
      await quantity(2);
      expect(await readSessakuPieceSet(prisma, key())).toMatchObject({ quantityWarning: null, pieces: [{ quantity: 1 }, { quantity: 1 }] });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.find((piece) => piece.id === done.id)).toEqual(done);
    });
    it('leaves unsplit later rows untouched on full merge', async () => {
      const r = await splitThree();
      await prisma.productionScheduleSessakuPieceSet.delete({ where: { id: (await readSessakuPieceSet(prisma, laterKey()))!.id } });
      await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardRowId: nextRowId } });
      const laterParent = (await laterItems())[0];
      const overrides = await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { itemKey: laterParent.itemId }, orderBy: { id: 'asc' } });
      const states = await prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { siteKey: { in: [site, other] } } });
      const result = await merge(r);
      expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: nextRowId } })).toBeNull();
      expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { itemKey: laterParent.itemId }, orderBy: { id: 'asc' } })).toEqual(overrides);
      for (const state of states) expect((await prisma.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { id: state.id } })).version).toBe(state.version + 1);
      expect(result.pieces).toEqual([]);
      expect(result.affectedItemIds).not.toContain(laterParent.itemId);
    });
    it('does not create incomplete Progress for an empty linked set', async () => {
      await splitThree();
      await importLaterQuantity('0');
      await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardRowId: nextRowId } });
      await reader.$transaction(async (tx) => {
        await acquireSessakuPieceLogicalLocks(tx, [laterKey()]);
        expect(await reconcileSessakuPieceProgress(tx, laterKey(), { emptyIsIncomplete: true })).toEqual({ sourceRowId: nextRowId, parentIsCompleted: false });
      });
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: nextRowId } })).toBeNull();
    });
    it.each(['create', 'update'])('does not retain cutting CSV zero with both sets empty (%s supplement)', async (path) => {
      await split();
      await importLaterQuantity('0');
      await quantity(0);
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      expect(cutting).toMatchObject({ pieces: [], sourcePieceSetId: null });
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [], sourcePieceSetId: cutting.id });
      await quantity(5);
      if (path === 'create') await prisma.productionScheduleOrderSupplement.delete({ where: { csvDashboardRowId: rowId } });
      const source = toSupplementNormalizedRow('source', { ProductNo: '123', FSIGENCD: '1', FKOJUN: '1', plannedQuantity: '0' })!;
      const supplement = await prisma.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: rowId } });
      const lookup = buildOrderSupplementKey(source);
      const plan = buildReplacementCreateInputs([source], new Map([[lookup, rowId]]), new Map(supplement ? [[lookup, supplement]] : []), new Date());
      await runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: 1, normalized: 1 });
      expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } })).plannedQuantity).toBe(path === 'update' ? 5 : null);
      if (path === 'create') await quantity(5);
      expect((await split()).pieces.map((piece) => piece.quantity)).toEqual([2, 3]);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [], sourcePieceSetId: cutting.id, plannedQuantity: 0 });
    });
    it.each(['1', '3'])('preserves a later parent placement on machine %s when resplitting cutting after raw supplement zero', async (resource) => {
      const cutting = await splitThree();
      await importLaterQuantity('0');
      const laterParent = (await laterItems())[0];
      await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: { csvDashboardId: dashboardId, siteKey: site, itemKey: laterParent.itemId, overrideResourceCd: resource, alternateRank: resource === '1' ? 1 : 7, orderPinned: true } });
      if (resource === '1') await prisma.productionScheduleGrindingPlanningBoardOverride.updateMany({ where: { siteKey: site, itemKey: { in: cutting.pieces.map((piece) => piece.itemId) } }, data: { alternateRank: { increment: 1 } } });
      const before = await prisma.productionScheduleGrindingPlanningBoardOverride.findUniqueOrThrow({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey: site, itemKey: laterParent.itemId } } });
      const current = (await board()).items.filter((item) => item.sourceRowId === rowId);
      await resplit({ ...cutting, pieces: current });
      const lane = (await allBoard()).items.filter((item) => item.effectiveResourceCd === resource && !item.isCompleted);
      expect(new Set(lane.map((item) => item.alternateRank)).size).toBe(lane.length);
      expect(await readSessakuPieceSet(prisma, laterKey())).toMatchObject({ pieces: [], sourcePieceSetId: (await readSessakuPieceSet(prisma, key()))!.id, plannedQuantity: 0 });
      const saved = await prisma.productionScheduleGrindingPlanningBoardOverride.findUniqueOrThrow({ where: { id: before.id } });
      expect(saved).toEqual(resource === '1' ? { ...before, version: before.version + 1, updatedAt: expect.any(Date) } : before);
    });
    it.each(['complete', 'incomplete'] as const)('excludes an unsplit third process from later %s responses and audits', async (intent) => {
      await splitThree();
      const finish = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FSIGENCD: '3', FKOJUN: '3' }, occurredAt: new Date(), dataHash: `${site}-third` } });
      if (intent === 'incomplete') await complete((await laterItems())[0]);
      const item = (await laterItems())[0];
      const result = await complete(item, intent);
      expect(result.affectedItemIds).toEqual([item.parentItemId, ...(await readSessakuPieceSet(prisma, laterKey()))!.pieces.map((piece) => `piece:${piece.id}`)]);
      const audit = await prisma.productionScheduleSessakuPieceAuditLog.findFirstOrThrow({ where: { fseiban: seiban, action: intent === 'complete' ? 'complete' : 'uncomplete' }, orderBy: { createdAt: 'desc' } });
      expect(JSON.stringify(audit.afterJson)).not.toContain(finish.id);
      expect(audit.afterJson).toMatchObject({ laterProcesses: [{ setId: (await readSessakuPieceSet(prisma, laterKey()))!.id }] });
      expect((audit.afterJson as { laterProcesses: unknown[] }).laterProcesses).toHaveLength(1);
      expect((await allBoard()).items.find((row) => row.sourceRowId === finish.id)?.kind).toBe('row');
    });
    it.each([2, 0])('does not add later quantities during external completion sync (plan=%s)', async (total) => {
      await laterQuantity(total); await splitThree();
      const before = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(before.pieces.map((piece) => piece.quantity)).toEqual(total ? [1, 1] : []);
      await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, isExternallyCompleted: true } });
      await new ProgressSyncFromCsvService().sync({ candidates: [{ rowId: nextRowId, rowData: { ...rowData, FSIGENCD: '2', FKOJUN: '2' }, occurredAt: new Date() }], locationKey: site });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(before.pieces);
      expect((await prisma.productionScheduleExternalCompletion.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isExternallyCompleted).toBe(true);
    });
    it('includes later changes and IDs in terminal split, resplit, completion, uncompletion and merge audits', async () => {
      const assertAudit = async (action: string) => {
        const later = (await readSessakuPieceSet(prisma, laterKey()))!;
        const audit = await prisma.productionScheduleSessakuPieceAuditLog.findFirstOrThrow({ where: { fseiban: seiban, action }, orderBy: { createdAt: 'desc' } });
        expect(audit.afterJson).toMatchObject({ laterProcesses: [{ setId: later.id, pieces: later.pieces.map(({ id, quantity, isCompleted }) => ({ id, quantity, isCompleted })) }] });
        expect(audit.pieceIds).toEqual(expect.arrayContaining(later.pieces.map((piece) => piece.id)));
      };
      let r = await splitThree(); await assertAudit('split');
      r = await resplit(r); await assertAudit('split');
      await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 7 } });
      r = await complete(r.pieces[0]); await assertAudit('complete');
      await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 5 } });
      r = await complete(r.pieces[0], 'incomplete'); await assertAudit('uncomplete');
      const laterIds = (await readSessakuPieceSet(prisma, laterKey()))!.pieces.map((piece) => piece.id);
      await merge(r);
      const audit = await prisma.productionScheduleSessakuPieceAuditLog.findFirstOrThrow({ where: { fseiban: seiban, action: 'merge' } });
      expect(audit.afterJson).toMatchObject({ laterProcesses: [] });
      expect(audit.pieceIds).toEqual(expect.arrayContaining(laterIds));
    });
    it.each(['supplement', 'csv'])('writes one committed propagate audit per part from %s import', async (path) => {
      await splitThree();
      const before = (await readSessakuPieceSet(prisma, laterKey()))!;
      const originalTransaction = prisma.$transaction.bind(prisma);
      const transaction = vi.spyOn(prisma, '$transaction');
      transaction.mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => originalTransaction(async (tx) => {
        const result = await callback(tx);
        expect(await reader.productionScheduleSessakuPieceAuditLog.count({ where: { fseiban: seiban, action: 'propagate' } })).toBe(0);
        return result;
      }, options)) as never);
      try {
        if (path === 'supplement') await importLaterQuantity('7');
        else {
          await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 7 } });
          const cuttingRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: rowId } });
          const laterRow = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
          await new ProgressSyncFromCsvService().sync({ candidates: [cuttingRow, laterRow].map((row) => ({ rowId: row.id, rowData: row.rowData, occurredAt: row.occurredAt })), locationKey: site });
        }
      } finally { transaction.mockRestore(); }
      const audits = await prisma.productionScheduleSessakuPieceAuditLog.findMany({ where: { fseiban: seiban, action: 'propagate' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ outcome: 'success', siteKey: path === 'csv' ? site : '__shared__', actorClientDeviceId: null,
        beforeJson: { laterProcesses: [{ setId: before.id, pieces: [{ quantity: 1 }, { quantity: 2 }, { quantity: 2 }] }] },
        afterJson: { laterProcesses: [{ setId: before.id, pieces: [{ quantity: 1 }, { quantity: 2 }, { quantity: 4 }] }] } });
    });
    it.each([
      ['supplement', 'FSIGENCD'], ['supplement', 'FKOJUN'], ['csv', 'FSIGENCD'], ['csv', 'FKOJUN']
    ] as const)('commits %s import and one propagate audit with a trailing blank %s row', async (path, field) => {
      await splitThree();
      const blank = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId,
        rowData: { ...rowData, FSIGENCD: '3', FKOJUN: '3', [field]: '' },
        dataHash: `${site}-blank`, occurredAt: new Date() } });
      if (path === 'supplement') {
        const sources = ['2', '3'].map((order) => toSupplementNormalizedRow('source', {
          ProductNo: '123', FSIGENCD: order, FKOJUN: order, plannedQuantity: '7'
        })!);
        const existing = await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } });
        // Include the incomplete schedule row last in the same update batch.
        await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId,
          csvDashboardRowId: blank.id, sourceCsvDashboardId: site, productNo: '123', resourceCd: '3', processOrder: '3', plannedQuantity: 5 } });
        const blankSupplement = await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: blank.id } });
        const plan = buildReplacementCreateInputs(sources,
          new Map([[buildOrderSupplementKey(sources[0]), nextRowId], [buildOrderSupplementKey(sources[1]), blank.id]]),
          new Map([existing, blankSupplement].map((entry) => [buildOrderSupplementKey(entry), entry])), new Date());
        await expect(runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: 2, normalized: 2 })).resolves.toMatchObject({ upserted: 2 });
        expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: blank.id } })).plannedQuantity).toBe(7);
      } else {
        await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 7 } });
        const later = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
        await expect(new ProgressSyncFromCsvService().sync({ candidates: [later, blank].map((row) => ({
          rowId: row.id, rowData: row.rowData, occurredAt: row.occurredAt
        })), locationKey: site })).resolves.toBeUndefined();
      }
      expect((await readSessakuPieceSet(prisma, laterKey()))!.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 4]);
      const audits = await prisma.productionScheduleSessakuPieceAuditLog.findMany({ where: { fseiban: seiban, action: 'propagate' } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ outcome: 'success', httpStatus: 200,
        beforeJson: { laterProcesses: [{ pieces: [{ quantity: 1 }, { quantity: 2 }, { quantity: 2 }] }] },
        afterJson: { laterProcesses: [{ pieces: [{ quantity: 1 }, { quantity: 2 }, { quantity: 4 }] }] } });
    });
    it.each(['supplement', 'csv'])('preserves committed %s import when audit storage fails', async (path) => {
      await splitThree();
      const auditWrite = vi.spyOn(prisma.productionScheduleSessakuPieceAuditLog, 'create').mockRejectedValue(new Error('audit storage unavailable'));
      try {
        if (path === 'supplement') await expect(importLaterQuantity('7')).resolves.toBeDefined();
        else {
          await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 7 } });
          const later = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
          await expect(new ProgressSyncFromCsvService().sync({ candidates: [{ rowId: later.id,
            rowData: later.rowData, occurredAt: later.occurredAt }], locationKey: site })).resolves.toBeUndefined();
        }
        expect(auditWrite).toHaveBeenCalledTimes(1);
        expect((await readSessakuPieceSet(prisma, laterKey()))!.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 4]);
      } finally { auditWrite.mockRestore(); }
    });
    it('does not audit rolled-back propagation as successful', async () => {
      await splitThree();
      const before = (await readSessakuPieceSet(prisma, laterKey()))!;
      const originalTransaction = prisma.$transaction.bind(prisma);
      const transaction = vi.spyOn(prisma, '$transaction');
      transaction.mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => originalTransaction(async (tx) => {
        await callback(tx); throw new Error('forced rollback');
      }, options)) as never);
      try { await expect(importLaterQuantity('7')).rejects.toThrow('forced rollback'); }
      finally { transaction.mockRestore(); }
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(before.pieces);
      expect(await prisma.productionScheduleSessakuPieceAuditLog.count({ where: { fseiban: seiban, action: 'propagate' } })).toBe(0);
    });
    it('keeps the entire later set and version identical on repeated quantity sync after removing zero work', async () => {
      const cutting = await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...key(), plannedQuantity: 2, nextPosition: 3,
        pieces: { create: [1, 2].map((position) => ({ position, quantity: 1 })) } }, include: { pieces: { orderBy: { position: 'asc' } } } });
      await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...laterKey(), sourcePieceSetId: cutting.id, plannedQuantity: 2, nextPosition: 4,
        pieces: { create: [
          { sourcePieceId: cutting.pieces[0].id, position: 1, quantity: 1, isCompleted: true, completedAt: new Date() },
          { sourcePieceId: cutting.pieces[0].id, position: 2, quantity: 1 },
          { sourcePieceId: cutting.pieces[1].id, position: 3, quantity: 1, isCompleted: true, completedAt: new Date() }
        ] } } });
      await laterQuantity(2);
      const first = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(first.pieces.map((piece) => piece.position)).toEqual([1, 2]);
      await laterQuantity(2);
      expect(await readSessakuPieceSet(prisma, laterKey())).toEqual(first);
    });
    it('imports a later total below completed quantity and deletes the zero unfinished tail', async () => {
      const cutting = await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...key(), nextPosition: 2,
        pieces: { create: { quantity: 3, position: 1 } } }, include: { pieces: true } });
      await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...laterKey(), sourcePieceSetId: cutting.id, nextPosition: 3,
        pieces: { create: [
          { quantity: 3, position: 1, sourcePieceId: cutting.pieces[0].id, isCompleted: true, completedAt: new Date() },
          { quantity: 2, position: 2, sourcePieceId: cutting.pieces[0].id }
        ] } } });
      await importLaterQuantity('2');
      const set = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(set.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
      expect(set.pieces).toMatchObject([{ quantity: 3, isCompleted: true }]);
    });
    it.each(['INVALID_PLANNED_QUANTITY', 'COMPLETED_QUANTITY_EXCEEDS_PLAN'])('blocks cutting split and merge for later warning %s', async (warning) => {
      const r = await splitThree();
      if (warning === 'INVALID_PLANNED_QUANTITY') await laterQuantity(-1);
      else { await complete((await laterItems())[0]); await laterQuantity(0); }
      expect((await readSessakuPieceSet(prisma, laterKey()))?.quantityWarning).toBe(warning);
      await expect(resplit(r)).rejects.toMatchObject({ statusCode: 409, code: 'PIECE_QUANTITY_CONFLICT' });
      await expect(merge(r)).rejects.toMatchObject({ statusCode: 409, code: 'PIECE_QUANTITY_CONFLICT' });
    });
    it('retains cutting quantities and source references when an invalid later plan prevents source deletion', async () => {
      await splitThree(); await laterQuantity(-1);
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      await quantity(2);
      expect((await readSessakuPieceSet(prisma, key()))).toMatchObject({ pieces: cutting.pieces, quantityWarning: 'INVALID_PLANNED_QUANTITY' });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(later.pieces);
    });
    it('allows cutting growth below the already completed later tail quantity', async () => {
      await laterQuantity(7); await splitThree(); await complete((await laterItems())[2]);
      await quantity(6);
      expect((await readSessakuPieceSet(prisma, key()))).toMatchObject({ quantityWarning: null, pieces: [{ quantity: 1 }, { quantity: 2 }, { quantity: 3 }] });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces[2]).toMatchObject({ quantity: 4, isCompleted: true });
    });
    it.each(['later-update', 'cutting-create'])('applies zero after first split and restores manual completion across winner replacement (%s)', async (path) => {
      if (path === 'cutting-create') await prisma.productionScheduleOrderSupplement.delete({ where: { csvDashboardRowId: nextRowId } });
      expect(await importLaterQuantity('0')).toMatchObject({ plannedQuantity: null, piecePlannedQuantity: 0 });
      expect((await prisma.productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).plannedQuantity).toBe(path === 'later-update' ? 5 : null);
      await splitThree();
      await importLaterQuantity('0');
      const empty = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(empty.pieces).toEqual([]); expect(empty.sourcePieceSetId).toBeTruthy();
      await setProductionScheduleRowCompletionIntent({ rowId: nextRowId, locationKey: site, intent: 'complete' });
      await importLaterQuantity('0');
      expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(true);
      const previousRowId = nextRowId;
      let replacementId = '';
      let release!: () => void, ready!: () => void;
      const held = new Promise<void>((resolve) => { ready = resolve; });
      const unlock = new Promise<void>((resolve) => { release = resolve; });
      const publication = reader.$transaction(async (tx) => {
        await acquireSessakuPieceLogicalLocks(tx, [laterKey()]);
        const states = await readSessakuPiecePublicationState(tx, [laterKey()]);
        const previous = await tx.csvDashboardRow.findUniqueOrThrow({ where: { id: previousRowId } });
        replacementId = (await tx.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...previous.rowData as Prisma.InputJsonObject, ProductNo: path === 'later-update' ? '999' : '123' },
          dataHash: `${site}-later-winner`, occurredAt: new Date(), updatedAt: new Date('2099-01-01') } })).id;
        await publishSessakuPieceProgress(tx, states);
        await tx.csvDashboardRow.delete({ where: { id: previousRowId } });
        ready(); await unlock;
      }, { timeout: 30000 });
      try {
        await held;
        expect((await findSessakuPieceWinner(prisma, laterKey()))?.id).toBe(previousRowId);
        expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: replacementId } })).toBeNull();
      } finally { release(); }
      await publication;
      nextRowId = replacementId;
      expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(true);
      if (path === 'later-update') await importLaterQuantity('5', '999');
      else {
        await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 5 } });
        await quantity(5);
      }
      const restored = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(restored.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
      expect(restored.pieces.every((piece) => piece.isCompleted && piece.completedAt)).toBe(true);
      expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(true);
    });
    it.each(['existing', 'earlier'])('keeps a single later owner with two cutting rows (%s splits first)', async (first) => {
      const earlier = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '0' }, dataHash: `${site}-earlier-cutting`, occurredAt: new Date() } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: earlier.id, sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: '0', plannedQuantity: 5 } });
      const splitRow = async (id: string) => {
        const p = (await board(false)).items.find((item) => item.sourceRowId === id)!;
        return splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [1, 2, 2] });
      };
      const r = await splitRow(first === 'existing' ? rowId : earlier.id);
      if (first === 'existing') await splitRow(earlier.id);
      else await expect(splitRow(rowId)).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_LOCKED' });
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(later.pieces.map((piece) => piece.sourcePieceId)).toEqual(r.pieces.map((piece) => piece.pieceId));
      expect(later.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
    });
    it.each([false, true])('adopts an empty cutting set and its later sets into one source before full merge (restore quantities=%s)', async (restore) => {
      const earlierData = { ...rowData, FKOJUN: '0' };
      const earlier = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: earlierData, dataHash: `${site}-earlier-cutting`, occurredAt: new Date() } });
      const earlierKey = sessakuPieceKeyFromRow(earlierData);
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: earlier.id, sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: '0', plannedQuantity: 5 } });
      await splitThree(); // B owns C before A is split.
      const importQuantities = async (raw: string) => {
        const sources = ['1', '2'].map((order) => toSupplementNormalizedRow('source', { ProductNo: '123', FSIGENCD: order, FKOJUN: order, plannedQuantity: raw })!);
        const supplements = await prisma.productionScheduleOrderSupplement.findMany({ where: { csvDashboardRowId: { in: [rowId, nextRowId] } } });
        const plan = buildReplacementCreateInputs(sources,
          new Map(sources.map((source, index) => [buildOrderSupplementKey(source), [rowId, nextRowId][index]])),
          new Map(supplements.map((supplement) => [buildOrderSupplementKey(supplement), supplement])), new Date());
        await runOrderSupplementReplacementTransaction(prisma, { ...plan, scanned: 2, normalized: 2 });
      };
      await importQuantities('0');
      const b = (await readSessakuPieceSet(prisma, key()))!;
      const c = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(b).toMatchObject({ pieces: [], sourcePieceSetId: null });
      expect(c).toMatchObject({ pieces: [], sourcePieceSetId: b.id });
      const splitEarlier = async () => {
        const p = (await board(false)).items.find((item) => item.sourceRowId === earlier.id)!;
        return splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: p.pieceSetVersion ?? 0, quantities: [2, 3] });
      };
      await setProductionScheduleRowCompletionIntent({ rowId: nextRowId, locationKey: site, intent: 'complete' });
      const protectedSet = await readSessakuPieceSet(prisma, laterKey());
      await expect(splitEarlier()).rejects.toMatchObject({ code: 'LATER_PROCESS_PIECE_COMPLETED' });
      expect(await readSessakuPieceSet(prisma, earlierKey)).toBeNull();
      expect(await readSessakuPieceSet(prisma, key())).toEqual(b);
      expect(await readSessakuPieceSet(prisma, laterKey())).toEqual(protectedSet);
      await setProductionScheduleRowCompletionIntent({ rowId: nextRowId, locationKey: site, intent: 'incomplete' });
      const r = await splitEarlier();
      const a = (await readSessakuPieceSet(prisma, earlierKey))!;
      for (const target of [key(), laterKey()]) expect(await readSessakuPieceSet(prisma, target)).toMatchObject({ sourcePieceSetId: a.id, pieces: [] });
      if (restore) {
        await importQuantities('5');
        for (const target of [key(), laterKey()]) {
          const saved = (await readSessakuPieceSet(prisma, target))!;
          expect(saved.sourcePieceSetId).toBe(a.id);
          expect(saved.pieces.map(({ sourcePieceId, quantity, position }) => ({ sourcePieceId, quantity, position })))
            .toEqual(a.pieces.map(({ id, quantity, position }) => ({ sourcePieceId: id, quantity, position })));
        }
      }
      await merge(r);
      expect(await readSessakuPieceSet(prisma, key())).toBeNull();
      expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
      const items = (await allBoard()).items;
      for (const id of [earlier.id, rowId, nextRowId]) expect(items.filter((item) => item.sourceRowId === id)).toMatchObject([{ kind: 'row' }]);
    });
    it('keeps an empty later set attached to its first cutting owner when another cutting row splits', async () => {
      await laterQuantity(0); const first = await splitThree();
      const second = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '0' }, dataHash: `${site}-second-cutting`, occurredAt: new Date() } });
      await prisma.productionScheduleOrderSupplement.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: second.id, sourceCsvDashboardId: site, productNo: '123', resourceCd: '1', processOrder: '0', plannedQuantity: 5 } });
      const p = (await board(false)).items.find((item) => item.sourceRowId === second.id)!;
      await splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [2, 3] });
      const later = (await readSessakuPieceSet(prisma, laterKey()))!;
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      expect(later.sourcePieceSetId).toBe(cutting.id); expect(later.pieces).toEqual([]);
      await laterQuantity(5);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.sourcePieceId)).toEqual(first.pieces.map((piece) => piece.pieceId));
    });
    it('does not recreate orphaned later pieces on resplit and removes the set on full merge', async () => {
      let r = await splitThree(); const old = (await readSessakuPieceSet(prisma, laterKey()))!;
      await prisma.csvDashboardRow.delete({ where: { id: nextRowId } });
      r = await resplit(r);
      const orphan = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(orphan.pieces.map((piece) => piece.id)).toEqual([old.pieces[0].id, old.pieces[2].id]);
      await quantity(5);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(orphan.pieces);
      r = await complete(r.pieces[0]);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(orphan.pieces);
      r = await complete(r.pieces[0], 'incomplete');
      await merge(r);
      expect(await readSessakuPieceSet(prisma, laterKey())).toBeNull();
    });
    it('absorbs a different later total immediately on split, resplit and partial merge', async () => {
      await laterQuantity(7);
      let r = await splitThree();
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 4]);
      r = await resplit(r);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1, 4]);
      r = await merge(r, r.pieces.slice(1));
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 6]);
    });
    it('discovers later parents when resplitting cutting pieces created before this feature', async () => {
      await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: dashboardId, ...key(), plannedQuantity: 5, nextPosition: 4, pieces: { create: [1, 2, 2].map((quantity, index) => ({ quantity, position: index + 1 })) } } });
      const p = await parent();
      const items = (await board()).items.filter((item) => item.sourceRowId === rowId);
      await resplit({ parentItemId: p.itemId, pieceSetVersion: p.pieceSetVersion!, pieces: items, sourceRowId: rowId, parentIsCompleted: false });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1, 2]);
    });
    it.each(['external', 'progress'])('rejects split and merge after a linked later row becomes %s completed', async (kind) => {
      const r = await splitThree();
      if (kind === 'external') await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: nextRowId, isExternallyCompleted: true } });
      else await prisma.productionScheduleProgress.update({ where: { csvDashboardRowId: nextRowId }, data: { isCompleted: true } });
      await expect(resplit(r)).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_COMPLETED' });
      await expect(merge(r)).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_COMPLETED' });
    });
    it('uses cutting planned quantity without a later supplement during creation and either sync direction', async () => {
      await prisma.productionScheduleOrderSupplement.delete({ where: { csvDashboardRowId: nextRowId } });
      await splitThree();
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
      await quantity(7);
      await reader.$transaction(async (tx) => { await acquireSessakuPieceLogicalLocks(tx, [laterKey()]); await synchronizeSessakuPieceSources(tx, [laterKey()]); });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 4]);
      await prisma.productionScheduleOrderSupplement.delete({ where: { csvDashboardRowId: rowId } });
      await reader.$transaction(async (tx) => { await acquireSessakuPieceLogicalLocks(tx, [laterKey()]); await synchronizeSessakuPieceSources(tx, [laterKey()]); });
      expect((await readSessakuPieceSet(prisma, laterKey()))?.plannedQuantity).toBe(7);
    });
    it('preserves existing quantities for an invalid later plan and recreates linked pieces after zero', async () => {
      const r = await splitThree();
      await laterQuantity(7);
      const before = (await readSessakuPieceSet(prisma, laterKey()))!.pieces;
      await laterQuantity(-1);
      let set = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(set.pieces).toEqual(before); expect(set.quantityWarning).toBe('INVALID_PLANNED_QUANTITY');
      await quantity(6);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual(before);
      await laterQuantity(0);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toEqual([]);
      await laterQuantity(7);
      set = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(set.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 4]);
      expect(set.pieces.map((piece) => piece.sourcePieceId)).toEqual(r.pieces.map((piece) => piece.pieceId));
      await laterQuantity(0); await prisma.productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: nextRowId }, data: { plannedQuantity: 5 } });
      await quantity(5);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 2, 2]);
    });
    it('warns on cutting shrink below completed linked quantity without discarding quantities', async () => {
      await splitThree(); await complete((await laterItems())[2]);
      const before = (await readSessakuPieceSet(prisma, key()))!.pieces;
      await quantity(4);
      const cutting = (await readSessakuPieceSet(prisma, key()))!;
      expect(cutting.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN'); expect(cutting.pieces).toEqual(before);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces[2]).toMatchObject({ quantity: 2, isCompleted: true });
    });
    it('mirrors both later stages in a three-process chain and returns both to rows on full merge', async () => {
      const finish = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '3', FSIGENCD: '3' }, occurredAt: new Date(), dataHash: `${site}-finish` } });
      const r = await splitThree();
      for (const id of [nextRowId, finish.id]) expect((await allBoard()).items.filter((item) => item.sourceRowId === id).map((item) => [item.quantity, item.sourcePieceId])).toEqual(r.pieces.map((piece) => [piece.quantity, piece.pieceId]));
      await merge(r);
      for (const id of [nextRowId, finish.id]) expect((await allBoard()).items.filter((item) => item.sourceRowId === id)).toMatchObject([{ kind: 'row' }]);
    });
    it.each(['split', 'merge'])('consolidates an unfinished later tail on structural %s', async (operation) => {
      await splitThree();
      for (const item of await laterItems()) await complete((await laterItems()).find((current) => current.pieceId === item.pieceId)!);
      await laterQuantity(7);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces).toHaveLength(4);
      // Return completion evidence to unfinished without reconciling away the extra tail first.
      await prisma.productionScheduleSessakuPiece.updateMany({ where: { pieceSet: { ...laterKey(), csvDashboardId: dashboardId } }, data: { isCompleted: false, completedAt: null } });
      await prisma.productionScheduleProgress.update({ where: { csvDashboardRowId: nextRowId }, data: { isCompleted: false } });
      const p = await parent(); const items = (await board()).items.filter((item) => item.sourceRowId === rowId);
      const current = { parentItemId: p.itemId, pieceSetVersion: p.pieceSetVersion!, pieces: items, sourceRowId: rowId, parentIsCompleted: false };
      if (operation === 'split') await resplit(current);
      else await merge(current, items.slice(0, 2));
      const set = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(set.pieces.map((piece) => piece.quantity)).toEqual(operation === 'split' ? [1, 1, 1, 4] : [3, 4]);
      expect(new Set(set.pieces.map((piece) => piece.position)).size).toBe(operation === 'split' ? 4 : 2);
      expect(set.pieces.every((piece) => piece.sourcePieceId)).toBe(true);
    });
    it.each(['dashboard', 'sets'])('allows cascade deletion of linked pieces with their %s in one statement', async (kind) => {
      const id = `${site}-cascade`;
      await prisma.csvDashboard.create({ data: { id, name: 'cascade', columnDefinitions: [], templateConfig: {} } });
      try {
        const cutting = await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: id, ...key(), pieces: { create: { quantity: 5, position: 1 } } }, include: { pieces: true } });
        await prisma.productionScheduleSessakuPieceSet.create({ data: { csvDashboardId: id, ...laterKey(), sourcePieceSetId: cutting.id, pieces: { create: { quantity: 5, position: 1, sourcePieceId: cutting.pieces[0].id } } } });
        if (kind === 'dashboard') await prisma.csvDashboard.delete({ where: { id } });
        else await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: id } });
        expect(await prisma.productionScheduleSessakuPiece.count({ where: { pieceSet: { csvDashboardId: id } } })).toBe(0);
      } finally { await prisma.csvDashboard.deleteMany({ where: { id } }); }
    });
    it.each(['completion', 'split'])('serializes first split and ordinary row completion on two connections (%s first)', async (first) => {
      const p = await parent();
      const splitRequest = () => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 2, 2] });
      const completionRequest = () => setProductionScheduleRowCompletionIntent({ rowId: nextRowId, locationKey: site, intent: 'complete' });
      let release!: () => void, ready!: () => void, competing!: () => void;
      const held = new Promise<void>((resolve) => { ready = resolve; });
      const unlock = new Promise<void>((resolve) => { release = resolve; });
      const attempted = new Promise<void>((resolve) => { competing = resolve; });
      const transaction = prisma.$transaction.bind(prisma);
      let count = 0;
      const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
        const index = count++;
        return transaction(async (tx) => {
          const execute = tx.$executeRaw.bind(tx);
          const executeWithBarrier = async (...args: Parameters<typeof execute>) => {
            const sql = String(args[0]);
            if (index === 1 && sql.includes('pg_advisory_xact_lock')) competing();
            const result = await execute(...args);
            if (index === 0 && String(args[1]).startsWith('sessaku-pieces:')) { ready(); await unlock; }
            return result;
          };
          const wrapped = new Proxy(tx, { get: (target, property) => property === '$executeRaw' ? executeWithBarrier : Reflect.get(target, property) });
          return callback(wrapped);
        }, options);
      }) as typeof prisma.$transaction);
      try {
        const leader = first === 'completion' ? completionRequest() : splitRequest();
        await held;
        const follower = first === 'completion' ? splitRequest() : completionRequest();
        await attempted;
        release();
        await Promise.all([leader, follower]);
        expect((await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } })).isCompleted).toBe(true);
        const set = await readSessakuPieceSet(prisma, laterKey());
        if (first === 'completion') expect(set).toBeNull();
        else { expect(set?.pieces).toHaveLength(3); expect(set?.pieces.every((piece) => piece.isCompleted)).toBe(true); }
      } finally { release(); spy.mockRestore(); }
    });
    async function serializeAtLogicalLock(leaderRequest: () => Promise<unknown>, followerRequest: () => Promise<unknown>) {
      let release!: () => void, ready!: () => void, competing!: () => void;
      const held = new Promise<void>((resolve) => { ready = resolve; });
      const unlock = new Promise<void>((resolve) => { release = resolve; });
      const attempted = new Promise<void>((resolve) => { competing = resolve; });
      const databaseFailures: unknown[] = [];
      const transaction = prisma.$transaction.bind(prisma);
      let count = 0;
      const spy = vi.spyOn(prisma, '$transaction').mockImplementation((async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => {
        const index = count++;
        return transaction(async (tx) => {
          const execute = tx.$executeRaw.bind(tx);
          let paused = false;
          const executeWithBarrier = async (...args: Parameters<typeof execute>) => {
            if (index === 1 && String(args[0]).includes('pg_advisory_xact_lock')) competing();
            const result = await execute(...args);
            if (index === 0 && !paused && String(args[1]).startsWith('sessaku-pieces:')) { paused = true; ready(); await unlock; }
            return result;
          };
          return callback(new Proxy(tx, { get: (target, property) => property === '$executeRaw' ? executeWithBarrier : Reflect.get(target, property) }));
        }, options).catch((error: unknown) => { databaseFailures.push(error); throw error; });
      }) as typeof prisma.$transaction);
      try {
        const leader = leaderRequest(); await held;
        const follower = followerRequest(); await attempted;
        release();
        const results = await Promise.allSettled([leader, follower]);
        for (const error of databaseFailures) {
          expect(error).not.toMatchObject({ code: 'P2034' });
          expect(String(error)).not.toMatch(/deadlock|40P01/i);
        }
        return results;
      } finally { release(); spy.mockRestore(); }
    }
    it.each(['csv', 'split'])('serializes CSV completion and first split with no initial set (%s first)', async (first) => {
      await prisma.csvDashboardRow.update({ where: { id: nextRowId }, data: { rowData: { ...rowData, FSIGENCD: '2', FKOJUN: '2', progress: '完了', updatedAt: '2099/01/01 00:00' } } });
      const candidate = await prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: nextRowId } });
      const csvRequest = () => new ProgressSyncFromCsvService().sync({ candidates: [{ rowId: nextRowId, rowData: candidate.rowData, occurredAt: candidate.occurredAt }] });
      const results = await serializeAtLogicalLock(first === 'csv' ? csvRequest : splitThree, first === 'csv' ? splitThree : csvRequest);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const set = await readSessakuPieceSet(prisma, laterKey());
      const progress = await prisma.productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: nextRowId } });
      if (first === 'csv') { expect(set).toBeNull(); expect(progress.isCompleted).toBe(true); }
      else { expect(set?.pieces).toHaveLength(3); expect(set?.pieces.every((piece) => !piece.isCompleted)).toBe(true); expect(progress.isCompleted).toBe(false); }
    });
    it.each(['import', 'split'])('serializes supplement import without an existing set against first split (%s first)', async (first) => {
      const p = await parent();
      const splitRequest = () => splitSessakuPieces({ siteKey: site, parentItemId: p.itemId, itemRevision: p.itemRevision, expectedPieceSetVersion: 0, quantities: [1, 2, 2] });
      const importRequest = () => importLaterQuantity('2');
      const results = await serializeAtLogicalLock(first === 'import' ? importRequest : splitRequest, first === 'import' ? splitRequest : importRequest);
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1]);
    });
    it.each(['import', 'split'])('serializes supplement logical/board locks against cutting critical/logical/board locks (%s first)', async (first) => {
      const r = await splitThree();
      const importRequest = () => importLaterQuantity('7');
      const splitRequest = () => resplit(r);
      const results = await serializeAtLogicalLock(first === 'import' ? importRequest : splitRequest, first === 'import' ? splitRequest : importRequest);
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 409 });
      }
      expect(results[0].status).toBe('fulfilled');
      expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.reduce((sum, piece) => sum + piece.quantity, 0)).toBe(7);
    });
    it.each(['completion', 'split'])('serializes later piece completion against cutting resplit (%s first)', async (first) => {
      const r = await splitThree(); const later = (await laterItems())[1];
      const splitRequest = () => resplit(r);
      const completeRequest = () => complete(later);
      const results = await serializeAtLogicalLock(first === 'completion' ? completeRequest : splitRequest, first === 'completion' ? splitRequest : completeRequest);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } });
      if (first === 'completion') {
        expect(results[1]).toMatchObject({ reason: { code: 'LATER_PROCESS_PIECE_COMPLETED' } });
        expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces[1].isCompleted).toBe(true);
      } else expect((await readSessakuPieceSet(prisma, laterKey()))?.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1, 2]);
      const source = (await readSessakuPieceSet(prisma, key()))!;
      const savedLater = (await readSessakuPieceSet(prisma, laterKey()))!;
      expect(source.pieces.map((piece) => piece.quantity)).toEqual(first === 'completion' ? [1, 2, 2] : [1, 1, 1, 2]);
      expect(savedLater.pieces.map((piece) => [piece.sourcePieceId, piece.quantity, piece.position])).toEqual(source.pieces.map((piece) => [piece.id, piece.quantity, piece.position]));
      expect(savedLater.pieces.filter((piece) => piece.isCompleted)).toHaveLength(first === 'completion' ? 1 : 0);
      expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: nextRowId } })).toMatchObject({ isCompleted: false });
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
    it.each([true, false])('handles two later rows with an externally completed process (linked=%s)', async (linked) => {
      const thirdKey = { ...key(), fsigencd: '3', fkojun: '3' };
      const third = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FSIGENCD: '3', FKOJUN: '3' }, dataHash: `${site}-third`, occurredAt: new Date() } });
      if (!linked) await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: third.id, isExternallyCompleted: true } });
      const cutting = await splitThree();
      if (linked) await prisma.productionScheduleExternalCompletion.create({ data: { csvDashboardId: dashboardId, csvDashboardRowId: third.id, isExternallyCompleted: true } });
      const before = await prisma.productionScheduleSessakuPieceSet.findMany({ where: { fseiban: seiban }, include: { pieces: { orderBy: { position: 'asc' } } }, orderBy: { id: 'asc' } });
      const overrides = await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: { in: [site, other] } }, orderBy: { id: 'asc' } });
      const states = await prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { siteKey: { in: [site, other] } }, orderBy: { siteKey: 'asc' } });
      if (linked) {
        await expect(resplit(cutting)).rejects.toMatchObject({ statusCode: 409, code: 'LATER_PROCESS_PIECE_COMPLETED' });
        expect(await prisma.productionScheduleSessakuPieceSet.findMany({ where: { fseiban: seiban }, include: { pieces: { orderBy: { position: 'asc' } } }, orderBy: { id: 'asc' } })).toEqual(before);
        expect(await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: { in: [site, other] } }, orderBy: { id: 'asc' } })).toEqual(overrides);
        expect(await prisma.productionScheduleGrindingPlanningBoardState.findMany({ where: { siteKey: { in: [site, other] } }, orderBy: { siteKey: 'asc' } })).toEqual(states);
      } else {
        await resplit(cutting);
        expect(await readSessakuPieceSet(prisma, thirdKey)).toBeNull();
        const source = (await readSessakuPieceSet(prisma, key()))!;
        const later = (await readSessakuPieceSet(prisma, laterKey()))!;
        expect(later.pieces.map((piece) => [piece.sourcePieceId, piece.quantity])).toEqual(source.pieces.map((piece) => [piece.id, piece.quantity]));
        expect(later.pieces.map((piece) => piece.quantity)).toEqual([1, 1, 1, 2]);
      }
      expect(await prisma.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: third.id } })).toMatchObject({ isExternallyCompleted: true });
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
    it('discovers later rows imported after the first split on the next operation', async () => {
      const r = await splitThree();
      const added = await prisma.csvDashboardRow.create({ data: { csvDashboardId: dashboardId, rowData: { ...rowData, FKOJUN: '3', FSIGENCD: '3' }, occurredAt: new Date(), dataHash: `${site}-late` } });
      await merge(r, [r.pieces[0], r.pieces[2]]);
      expect((await allBoard()).items.filter((item) => item.sourceRowId === added.id).map((item) => item.quantity)).toEqual([3, 2]);
    });
  });

});
