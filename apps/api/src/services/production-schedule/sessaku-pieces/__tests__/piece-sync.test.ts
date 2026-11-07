import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { describe, expect, it, vi } from 'vitest';
import { lockAllSessakuPieceSets, lockSessakuPieceSourceRows, prepareSessakuPiecePublication, synchronizeSessakuPieceSources } from '../piece-sync.js';
import { readSessakuPieceSets } from '../piece-key.js';
import { publishSessakuPieceSourceCreates } from '../piece-source-publication.js';

const key = { fseiban: 'A', fhincd: 'P', fsigencd: '1', fkojun: '1' };
const rowData = { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '1', FKOJUN: '1' };
function client(sets: unknown[] = []) {
  return {
    productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue(sets), findUnique: vi.fn().mockResolvedValue(sets[0] ?? null), update: vi.fn() },
    csvDashboardRow: { findMany: vi.fn().mockResolvedValue([{ id: 'row', rowData }]), createMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'new', occurredAt: new Date() }) },
    $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]), $transaction: vi.fn()
  };
}
describe('piece publication lock budget and legacy paths', () => {
  it('mail sync reads only live sets, with no row scan, logical lock or board lock when empty', async () => {
    const tx = client();
    expect(await lockAllSessakuPieceSets(tx as never)).toEqual([]);
    expect(tx.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ pieces: { some: {} } }, { sourcePieceSetId: { not: null } }] }) }));
    expect(tx.csvDashboardRow.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('mail locks query only the same parts as live sets', async () => {
    const tx = client([{ ...key, pieces: [{ id: 'p' }] }, { ...key, fseiban: 'B', pieces: [{ id: 'q' }] }]);
    tx.csvDashboardRow.findMany.mockResolvedValue([]);
    await lockAllSessakuPieceSets(tx as never, true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.csvDashboardRow.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'A', 'P', 'B', 'P']);
  });
  it.each([{ sets: [] }, { sets: [{ ...key, id: 'tombstone', pieces: [] }] }])('locks ordinary/tombstone source keys without winner or board queries %j', async ({ sets }) => {
    const tx = client(sets);
    expect(await lockSessakuPieceSourceRows(tx as never, ['row'])).toEqual([key]);
    expect(await prepareSessakuPiecePublication(tx as never, [{ rowData }])).toEqual([]);
    await synchronizeSessakuPieceSources(tx as never, [key]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleSessakuPieceSet.update).not.toHaveBeenCalled();
  });
  it('looks up 7200 parent keys in one fseiban IN query and filters unrelated sibling keys', async () => {
    const tx = client([{ ...key, pieces: [] }, { ...key, fhincd: 'unrelated', pieces: [] }]);
    const rows = Array.from({ length: 7200 }, () => ({ rowData }));
    expect((await readSessakuPieceSets(tx as never, rows)).size).toBe(1);
    expect(tx.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { csvDashboardId: expect.any(String), fseiban: { in: ['A'] } } }));
  });
  it.each([{ sets: [] }, { sets: [{ ...key, pieces: [] }] }])('keeps APPEND createMany without transactions or mail locks %j', async ({ sets }) => {
    const tx = client(sets);
    const rows = [{ csvDashboardId: 'production-schedule', rowData, occurredAt: new Date() }];
    await publishSessakuPieceSourceCreates(tx as never, rows, { collectCreatedRows: false });
    expect(tx.csvDashboardRow.createMany).toHaveBeenCalledExactlyOnceWith({ data: rows });
    expect(tx.csvDashboardRow.create).not.toHaveBeenCalled();
    expect(tx.$transaction).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('keeps DEDUP per-row creation and candidate IDs without a new transaction', async () => {
    const tx = client();
    const occurredAt = new Date();
    const published = await publishSessakuPieceSourceCreates(tx as never, [{ csvDashboardId: 'production-schedule', rowData, occurredAt }]);
    expect(published).toEqual([{ rowId: 'new', rowData, occurredAt }]);
    expect(tx.$transaction).not.toHaveBeenCalled();
  });
});
