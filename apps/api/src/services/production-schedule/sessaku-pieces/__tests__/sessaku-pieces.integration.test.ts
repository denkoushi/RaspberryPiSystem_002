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
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import { createPrismaClient } from '../../../../lib/prisma-client.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../constants.js';
import { getGrindingPlanningBoard, updateGrindingPlanningBoardArrival, updateGrindingPlanningBoardRank, updateGrindingPlanningBoardResourceOrder } from '../../grinding-planning-board.service.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../../leaderboard/leaderboard-shell-snapshot.store.js';
import { splitSessakuPieces, mergeSessakuPieces, setSessakuPieceCompletion } from '../sessaku-pieces.service.js';
import { encodeSessakuPieceKey, acquireSessakuPieceLogicalLocks, sessakuPieceKeyFromRow, readSessakuPieceSet, readSessakuPieceSets, findSessakuPieceWinner } from '../piece-key.js';
import { reconcileSessakuPieceQuantities } from '../piece-quantity.js';
import { reconcileSessakuPieceProgress } from '../piece-completion.js';
import { publishSessakuPieceProgress, readSessakuPiecePublicationState, synchronizeSessakuPieceSources } from '../piece-sync.js';
import { setProductionScheduleRowCompletionIntent } from '../../production-schedule-command.service.js';
import { ProgressSyncFromCsvService } from '../../progress-sync-from-csv.service.js';
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
    await prisma.productionScheduleSessakuPieceAuditLog.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: { in: [site, other] } } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: dashboardId, dataHash: { startsWith: site } } });
    await prisma.dueManagementOutcomeEvent.deleteMany({ where: { fseiban: seiban } });
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await reader.$disconnect(); await prisma.$disconnect(); });
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
          FSIGENCD: j === 0 && i < 40 ? (i === 0 ? '\t1\u3000' : '1') : j === 1 && i < 25 ? '3' : '2' },
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
          pieces: { select: { id: true, position: true, quantity: true, isCompleted: true, completedAt: true }, orderBy: { position: 'asc' } } },
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
      for (const piece of fullResult.pieces) {
        const actualPiece = result.pieces.find((p) => p.piecePosition === piece.piecePosition)!;
        expect(actualPiece).toBeDefined();
        expectedJson = expectedJson.replaceAll(piece.pieceId!, actualPiece.pieceId!);
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
        const expected = before[index].filter((item) => item.effectiveResourceCd === resource && !item.isCompleted)
          .flatMap((item) => item.itemId === p.itemId ? result.pieces.map((piece) => piece.itemId) : [item.itemId]);
        const actual = (await project(targetSite)).filter((item) => item.effectiveResourceCd === resource && !item.isCompleted);
        expect(actual.map((item) => item.itemId)).toEqual(expected);
        expect(actual.map((item) => item.alternateRank)).toEqual(expected.map((_, i) => i + 1));
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
      const merged = await compareOperation('merge', (audit) => mergeSessakuPieces({ siteKey: site, parentItemId: p.itemId,
        expectedPieceSetVersion: mergeVersion, pieceIds: remaining.map((item) => item.pieceId!), itemRevisions: Object.fromEntries(remaining.map((item) => [item.itemId, item.itemRevision])), audit }));
      expect(merged.pieces).toEqual([]);
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
      const sourceSpy = vi.spyOn(projectionSource, 'readWinnerRowsByFseibans').mockImplementation((client, fseibans) => originalSource(client, fseibans));
      const overrideSpy = vi.spyOn(projectionSource, 'readOverrides').mockImplementation((client, targetSite) => originalOverrides(client, targetSite));
      const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: (tx: Prisma.TransactionClient) => Promise<SessakuPiecesMutationResponse>, options: object) =>
        originalTransaction(async (tx) => {
          fullResult = await callback(tx); expected = await snapshot(tx); throw rollback;
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
    expect(logs[0]).toMatchObject({ outcome: 'success', requestedQuantities: [2, 3], timing: { siteCount: 2, upsertCount: 4, lockWaitMs: expect.any(Number), beforeProjectionMs: expect.any(Number), writeMs: expect.any(Number), afterProjectionMs: expect.any(Number), totalMs: expect.any(Number) }, resultVersion: result.pieceSetVersion, afterJson: { count: 2, quantities: [2, 3] } });
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
    const after = await board(); expect(after.items.filter((i) => i.kind === 'piece').every((i) => i.manualArrivalDate != null)).toBe(true);
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
    await quantity(1); expect((await board(true, site, 'incomplete')).items.find((i) => i.kind === 'piece')?.quantityWarning).toBe('COMPLETED_QUANTITY_EXCEEDS_PLAN');
    await quantity(5); await external(true); await quantity(4);
    const warned = (await board(true, site, 'incomplete')).items.filter((i) => i.kind === 'piece'); expect(warned).toHaveLength(2); expect(warned.every((i) => i.isCompleted && i.quantityWarning)).toBe(true);
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
    const r = await split(); const otherBefore = (await board(true, other)).items.filter((i) => i.kind === 'piece'); const b = await board();
    await updateGrindingPlanningBoardResourceOrder({ siteKey: site, sourceRevision: b.sourceRevision, itemId: r.pieces[1].itemId, itemRevision: r.pieces[1].itemRevision, targetItemId: r.pieces[0].itemId, targetItemRevision: r.pieces[0].itemRevision, placement: 'before' });
    expect((await readSessakuPieceSet(prisma, key()))?.version).toBe(r.pieceSetVersion);
    expect((await board(true, other)).items.filter((i) => i.kind === 'piece').map((i) => i.itemId)).toEqual(otherBefore.map((i) => i.itemId));
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
    let items = (await board()).items.filter((p) => p.kind === 'piece'); await complete(items[1]);
    await setProductionScheduleRowCompletionIntent({ rowId, locationKey: site, intent: 'complete' });
    expect((await readSessakuPieceSet(prisma, key()))?.pieces.map((p) => p.isCompleted)).toEqual([true, false]);
    await prisma.productionScheduleFkojunstMailStatus.update({ where: { id: mail.id }, data: { statusCode: 'S' } }); await sync();
    items = (await board()).items.filter((p) => p.kind === 'piece'); expect(items.map((p) => p.isCompleted)).toEqual([true, false]);
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
    const before = await readPlanningSnapshotGenerationToken(other); const item = (await board()).items.find((p) => p.kind === 'piece')!; await complete(item);
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
    if (!(await readSessakuPieceSet(prisma, key()))?.pieces.length) r = await split(); else r.pieces = (await board()).items.filter((p) => p.kind === 'piece');
    const one = (await board()).items.find((p) => p.kind === 'piece')!; const two = (await board(true, other)).items.find((p) => p.kind === 'piece')!;
    const edits = await Promise.allSettled([updateGrindingPlanningBoardRank({ siteKey: site, sourceRevision: (await board()).sourceRevision, itemId: one.itemId, itemRevision: one.itemRevision, alternateRank: 10 }), updateGrindingPlanningBoardRank({ siteKey: other, sourceRevision: (await board(true, other)).sourceRevision, itemId: two.itemId, itemRevision: two.itemRevision, alternateRank: 20 })]);
    expect(edits.every((entry) => entry.status === 'fulfilled')).toBe(true);
  });
  it('expands due-scope updates to all pieces and clears their ranks', async () => {
    const r = await split(); const snapshot = await getGrindingPlanningBoardDueScope({ siteKey: site, deviceScopeKey: site, fseiban: seiban });
    await updateGrindingPlanningBoardDueScope({ siteKey: site, fseiban: seiban, request: { sourceGenerationToken: snapshot.sourceGenerationToken, scopeRevision: snapshot.scopeRevision, scope: { kind: 'seiban' }, dueDate: '2099-01-01' } });
    const items = (await board()).items.filter((p) => p.kind === 'piece'); expect(items).toHaveLength(r.pieces.length); expect(items.every((p) => p.effectiveDueDate === '2099-01-01' && p.alternateRank === null)).toBe(true);
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

});
