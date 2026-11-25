import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';
import { lockSupersededOrderCarryOverPairs } from '../superseded-order-carry-over.js';
import { refreshSupersededProductionScheduleRows } from '../superseded-order-marker.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const D = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const keyOf = (productNo: string) => ({
  FSEIBAN: 'BA1SC381', FHINCD: 'MD005279290', FSIGENCD: '200', FKOJUN: '10', ProductNo: productNo,
});
const itemKeyOf = (productNo: string) => buildGrindingPlanningBoardRowItemId(keyOf(productNo));
const statusKey = (productNo: string) => buildFkojunstMailStatusKey({ fkojun: '10', fkoteicd: '200', fsezono: productNo });
const xStatus = (...productNos: string[]) => new Map(productNos.map((p) => [statusKey(p), 'X']));
const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function createRow(id: string, productNo: string, over: Record<string, string> = {}) {
  await prisma.csvDashboardRow.create({
    data: { id, csvDashboardId: D, occurredAt: day('2026-11-25'), dataHash: `hash-${id}`, rowData: { ...keyOf(productNo), ...over } },
  });
}

async function reset() {
  await prisma.csvDashboard.deleteMany({ where: { id: D } });
  await prisma.csvDashboard.create({
    data: {
      id: D, name: 'ProductionSchedule_Test', ingestMode: 'APPEND', columnDefinitions: [],
      templateType: 'TABLE', templateConfig: { rowsPerPage: 10, fontSize: 14, displayColumns: [] },
    },
  });
  await createRow('old', '0004000001');
  await createRow('new', '0004000002');
  await createRow('newer-old', '0004000000'); // 別の古い番号(同じ引き継ぎ先に行く)
}

async function seedOldRowData(rowId: string, productNo: string, tag: string) {
  await prisma.productionScheduleRowNote.create({ data: { csvDashboardId: D, csvDashboardRowId: rowId, note: `note-${tag}` } });
  await prisma.productionScheduleOrderAssignment.create({
    data: { csvDashboardId: D, csvDashboardRowId: rowId, location: 'loc1', siteKey: 's', resourceCd: '200', orderNumber: tag === 'a' ? 1 : 2 },
  });
  await prisma.productionScheduleGlobalRowRank.create({
    data: { csvDashboardId: D, csvDashboardRowId: rowId, location: 'loc1', fseiban: 'BA1SC381', globalRank: tag === 'a' ? 1 : 2 },
  });
  const split = await prisma.productionScheduleOrderSplit.create({
    data: { csvDashboardId: D, parentCsvDashboardRowId: rowId, splitNo: 1, splitQuantity: 3 },
  });
  await prisma.productionScheduleOrderSplitAssignment.create({
    data: { csvDashboardId: D, splitId: split.id, location: 'loc1', siteKey: 's', resourceCd: '200', orderNumber: tag === 'a' ? 11 : 12 },
  });
  await prisma.productionScheduleProgress.create({ data: { csvDashboardId: D, csvDashboardRowId: rowId, isCompleted: true } });
  const itemKey = itemKeyOf(productNo);
  await prisma.productionScheduleGrindingPlanningBoardOverride.create({
    data: { csvDashboardId: D, siteKey: 's', itemKey, overrideResourceCd: tag === 'a' ? '300' : '400' },
  });
  await prisma.productionScheduleGrindingPlanningBoardArrival.create({
    data: { csvDashboardId: D, siteKey: 's', itemKey, arrivalDate: day('2026-11-26') },
  });
  await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.create({
    data: { csvDashboardId: D, siteKey: 's', itemKey, state: 'arrived', recordedAt: new Date('2026-11-25T00:00:00Z') },
  });
}

describe('refreshSupersededProductionScheduleRows carry-over (real PostgreSQL)', () => {
  beforeEach(reset);
  afterAll(async () => {
    await prisma.csvDashboard.deleteMany({ where: { id: D } });
    await prisma.$disconnect();
  });

  it('印を付けた古い行から、新しい番号の行へすべて移る。2回目は何も移らない', async () => {
    await seedOldRowData('old', '0004000001', 'a');

    const first = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001', '0004000000') });
    expect(first.marked).toBe(2);
    expect(first.carriedOver).toMatchObject({
      targets: 2, rowNotes: 1, orderAssignments: 1, globalRowRanks: 1, orderSplits: 1, progress: 1,
      grindingOverrides: 1, grindingArrivals: 1, grindingFirstProcessArrivals: 1, sessakuPieceSets: 0, sessakuPieceHistories: 0,
    });
    expect((await prisma.csvDashboardRow.findUnique({ where: { id: 'old' } }))?.supersededAt).not.toBeNull();
    expect((await prisma.csvDashboardRow.findUnique({ where: { id: 'new' } }))?.supersededAt).toBeNull();

    expect(await prisma.productionScheduleRowNote.findMany({ select: { csvDashboardRowId: true } })).toEqual([{ csvDashboardRowId: 'new' }]);
    expect((await prisma.productionScheduleOrderAssignment.findMany()).map((r) => r.csvDashboardRowId)).toEqual(['new']);
    expect((await prisma.productionScheduleGlobalRowRank.findMany()).map((r) => r.csvDashboardRowId)).toEqual(['new']);
    const splits = await prisma.productionScheduleOrderSplit.findMany({ include: { assignments: true } });
    expect(splits.map((s) => s.parentCsvDashboardRowId)).toEqual(['new']);
    expect(splits[0]?.assignments).toHaveLength(1);
    expect((await prisma.productionScheduleProgress.findMany()).map((r) => r.csvDashboardRowId)).toEqual(['new']);
    const newKey = itemKeyOf('0004000002');
    expect((await prisma.productionScheduleGrindingPlanningBoardOverride.findMany()).map((r) => r.itemKey)).toEqual([newKey]);
    expect((await prisma.productionScheduleGrindingPlanningBoardArrival.findMany()).map((r) => r.itemKey)).toEqual([newKey]);
    expect((await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany()).map((r) => r.itemKey)).toEqual([newKey]);

    const second = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001', '0004000000') });
    expect(second).toMatchObject({ marked: 0, cleared: 0, carriedOver: null });
    expect(await prisma.productionScheduleRowNote.count()).toBe(1);
  });

  it('引き継ぎ先に既にあるものは古い行から移さず、古い行に残る', async () => {
    await seedOldRowData('old', '0004000001', 'a');
    await seedOldRowData('new', '0004000002', 'b');

    const result = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001') });
    expect(result.carriedOver).toMatchObject({
      rowNotes: 0, orderAssignments: 0, globalRowRanks: 0, orderSplits: 0, progress: 0,
      grindingOverrides: 0, grindingArrivals: 0, grindingFirstProcessArrivals: 0,
    });
    const notes = await prisma.productionScheduleRowNote.findMany({ orderBy: { csvDashboardRowId: 'asc' } });
    expect(notes.map((n) => [n.csvDashboardRowId, n.note])).toEqual([['new', 'note-b'], ['old', 'note-a']]);
    expect(await prisma.productionScheduleGrindingPlanningBoardOverride.count()).toBe(2);
  });

  it('同じ引き継ぎ先に複数の古い行があるとき、ProductNo が大きい古い行のものが先に移り、衝突しない', async () => {
    await seedOldRowData('old', '0004000001', 'a');
    await seedOldRowData('newer-old', '0004000000', 'b');

    await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001', '0004000000') });
    const notes = await prisma.productionScheduleRowNote.findMany({ orderBy: { csvDashboardRowId: 'asc' } });
    expect(notes.map((n) => [n.csvDashboardRowId, n.note])).toEqual([['new', 'note-a'], ['newer-old', 'note-b']]);
  });

  const pieceKey = (productNo: string) => ({ csvDashboardId: D, fseiban: 'BA1SC381', fhincd: 'MD005279290', fsigencd: '200', fkojun: '10', productNo });

  it('切削の分割(セットと履歴)も新しい番号に付け替わり、片も一緒についていく', async () => {
    const set = await prisma.productionScheduleSessakuPieceSet.create({ data: { ...pieceKey('0004000001'), pieces: { create: [{ position: 1, quantity: 2 }, { position: 2, quantity: 3 }] } } });
    await prisma.productionScheduleSessakuPieceHistory.create({ data: pieceKey('0004000001') });

    const result = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001') });
    expect(result.carriedOver).toMatchObject({ sessakuPieceSets: 1, sessakuPieceHistories: 1 });
    const sets = await prisma.productionScheduleSessakuPieceSet.findMany({ include: { pieces: true } });
    expect(sets.map((s) => [s.id, s.productNo, s.pieces.length])).toEqual([[set.id, '0004000002', 2]]);
    expect((await prisma.productionScheduleSessakuPieceHistory.findMany()).map((h) => h.productNo)).toEqual(['0004000002']);
  });

  it('引き継ぎ先の番号に切削の分割が既にあれば、古い番号のセットと履歴は移さず残る', async () => {
    await prisma.productionScheduleSessakuPieceSet.create({ data: pieceKey('0004000001') });
    await prisma.productionScheduleSessakuPieceSet.create({ data: pieceKey('0004000002') });
    await prisma.productionScheduleSessakuPieceHistory.create({ data: pieceKey('0004000001') });
    await prisma.productionScheduleSessakuPieceHistory.create({ data: pieceKey('0004000002') });

    const result = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001') });
    expect(result.carriedOver).toMatchObject({ sessakuPieceSets: 0, sessakuPieceHistories: 0 });
    expect((await prisma.productionScheduleSessakuPieceSet.findMany({ orderBy: { productNo: 'asc' } })).map((s) => s.productNo)).toEqual(['0004000001', '0004000002']);
    expect(await prisma.productionScheduleSessakuPieceHistory.count()).toBe(2);
  });

  it('同じ引き継ぎ先に古い番号が2つあっても、切削のセットは1つだけ移り一意制約に当たらない', async () => {
    await prisma.productionScheduleSessakuPieceSet.create({ data: pieceKey('0004000001') });
    await prisma.productionScheduleSessakuPieceSet.create({ data: pieceKey('0004000000') });
    await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001', '0004000000') });
    expect((await prisma.productionScheduleSessakuPieceSet.findMany({ orderBy: { productNo: 'asc' } })).map((s) => s.productNo)).toEqual(['0004000000', '0004000002']);
  });

  it('印が外れても(古い番号の復活)移したものは戻さない', async () => {
    await seedOldRowData('old', '0004000001', 'a');
    await refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001') });
    const result = await refreshSupersededProductionScheduleRows(prisma, { statusByKey: new Map([[statusKey('0004000001'), 'P']]) });
    expect(result).toMatchObject({ marked: 0, cleared: 1, carriedOver: null });
    expect((await prisma.productionScheduleRowNote.findMany()).map((n) => n.csvDashboardRowId)).toEqual(['new']);
  });

  it('引き継ぎ先が見つからない行は何も移さない', async () => {
    await seedOldRowData('old', '0004000001', 'a');
    // new / newer-old を別キーにして、old に引き継ぎ先が無い状態にする(定義上は起きないが守る)
    await prisma.csvDashboardRow.update({ where: { id: 'new' }, data: { supersededAt: new Date() } });
    await prisma.csvDashboardRow.update({ where: { id: 'newer-old' }, data: { supersededAt: new Date() } });
    const pairs = await prisma.$transaction((tx) => lockSupersededOrderCarryOverPairs(tx, ['old'], []));
    expect(pairs).toEqual([]);
    expect((await prisma.productionScheduleRowNote.findMany()).map((n) => n.csvDashboardRowId)).toEqual(['old']);
  });

  it('引き継ぎで失敗したら、印の付け直しも戻る', async () => {
    await seedOldRowData('old', '0004000001', 'a');
    // 引き継ぎ先の備考の主キー衝突を人為的に起こす: 備考の csvDashboardRowId に一意違反を起こすトリガー
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fail_note_move() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_note_move BEFORE UPDATE ON "ProductionScheduleRowNote" FOR EACH ROW EXECUTE FUNCTION fail_note_move()`);
    try {
      await expect(
        refreshSupersededProductionScheduleRows(prisma, { statusByKey: xStatus('0004000001') })
      ).rejects.toThrow();
      expect((await prisma.csvDashboardRow.findUnique({ where: { id: 'old' } }))?.supersededAt).toBeNull();
      expect((await prisma.productionScheduleRowNote.findMany()).map((n) => n.csvDashboardRowId)).toEqual(['old']);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_note_move ON "ProductionScheduleRowNote"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_note_move()`);
    }
  });
});
