import { logger } from '../../../lib/logger.js';
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: vi.fn(), child: () => ({ info: vi.fn() }) } }));
import { synchronizeSessakuPieceSources } from '../sessaku-pieces/piece-sync.js';
vi.mock('../sessaku-pieces/piece-sync.js', () => ({ synchronizeSessakuPieceSources: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressSyncFromCsvService } from '../progress-sync-from-csv.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([]),
    csvDashboardRow: { findMany: vi.fn() },
    productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
    productionScheduleProgress: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn() },
    dueManagementOutcomeEvent: { create: vi.fn() }
  }
}));

const candidate = { rowId: 'row-1', rowData: { progress: '完了', updatedAt: '2026/02/25 10:00' }, occurredAt: new Date('2026-02-25') };
const persisted = { id: candidate.rowId, rowData: candidate.rowData, occurredAt: candidate.occurredAt };
describe('ProgressSyncFromCsvService', () => {
  const service = new ProgressSyncFromCsvService();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([persisted] as never);
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleProgress.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleProgress.upsert).mockResolvedValue({} as never);
  });

  it.each([
    ['newer CSV completion', '完了', false, '2026-02-24', true, true],
    ['blank preserves manual completion', '', true, '2026-02-24', null, false],
    ['blank keeps incomplete', '', false, '2026-02-24', false, false],
    ['same timestamp prefers system', '完了', false, '2026-02-25T01:00:00Z', null, false],
    ['older CSV', '完了', false, '2026-02-25T02:00:00Z', null, false],
    ['missing Progress', '完了', null, '2026-02-24', true, true]
  ] as const)('%s', async (_label, progress, existingIsCompleted, existingAt, expected, event) => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ ...persisted, rowData: { ...candidate.rowData, progress } }] as never);
    vi.mocked(prisma.productionScheduleProgress.findMany).mockResolvedValue(existingIsCompleted === null ? [] : [
      { csvDashboardRowId: candidate.rowId, updatedAt: new Date(existingAt), isCompleted: existingIsCompleted }
    ] as never);
    await service.sync({ candidates: [candidate] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    if (expected === null) expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
    else expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { csvDashboardRowId: candidate.rowId }, create: expect.objectContaining({ isCompleted: expected }), update: expect.objectContaining({ isCompleted: expected })
    }));
    expect(prisma.dueManagementOutcomeEvent.create).toHaveBeenCalledTimes(event ? 1 : 0);
  });

  it('rereads the CSV timestamp after locking instead of using a stale candidate', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ ...persisted, rowData: { progress: '', updatedAt: '2026/02/23 10:00' } }] as never);
    vi.mocked(prisma.productionScheduleProgress.findMany).mockResolvedValue([{ csvDashboardRowId: candidate.rowId, isCompleted: false, updatedAt: new Date('2026-02-24') }] as never);
    await service.sync({ candidates: [candidate] });
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
    expect(prisma.csvDashboardRow.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(prisma.$executeRaw.mock.invocationCallOrder[0]);
  });

  it('does not write a row whose key changed before locking', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ ...persisted, rowData: { ...candidate.rowData, FSEIBAN: 'changed' } }] as never);
    await service.sync({ candidates: [candidate] });
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
  });

  it('skips ordinary rows without a progress column', async () => {
    await service.sync({ candidates: [candidate], hasProgressColumn: false });
    expect(prisma.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
  });

  it('reconciles live pieces without a progress column after rereading sets', async () => {
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mockResolvedValue([{ fseiban: '', fhincd: '', fsigencd: '', fkojun: '', pieces: [{ id: 'piece' }] }] as never);
    await service.sync({ candidates: [candidate], hasProgressColumn: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(synchronizeSessakuPieceSources).toHaveBeenCalledExactlyOnceWith(prisma, [{ fseiban: '', fhincd: '', fsigencd: '', fkojun: '' }]);
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
  });

  it('batches hundreds of ordinary rows instead of opening one transaction per row', async () => {
    const candidates = Array.from({ length: 250 }, (_, index) => ({ ...candidate, rowId: `row-${index}` }));
    vi.mocked(prisma.csvDashboardRow.findMany).mockImplementation(async (args) => candidates.filter((row) => (args?.where?.id as { in: string[] }).in.includes(row.rowId)).map((row) => ({ id: row.rowId, rowData: row.rowData, occurredAt: row.occurredAt })) as never);
    await service.sync({ candidates });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.csvDashboardRow.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.productionScheduleProgress.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(250);
  });
  it('retries a failed batch row by row and continues later batches', async () => {
    const candidates = Array.from({ length: 250 }, (_, index) => ({ ...candidate, rowId: `row-${index}` }));
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('SQL private values'));
    vi.mocked(prisma.csvDashboardRow.findMany).mockImplementation(async (args) => candidates.filter((row) => (args?.where?.id as { in: string[] }).in.includes(row.rowId)).map((row) => ({ id: row.rowId, rowData: row.rowData, occurredAt: row.occurredAt })) as never);
    await expect(service.sync({ candidates })).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(103);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(250);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ count: 100, rowIds: ['row-0', 'row-1', 'row-2', 'row-3', 'row-4'] }, 'CSV progress sync batch failed');
  });

  it('finishes other batches but rejects if an individual row still times out', async () => {
    const candidates = Array.from({ length: 250 }, (_, index) => ({ ...candidate, rowId: `row-${index}` }));
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('Transaction expired waiting for lock'));
    vi.mocked(prisma.csvDashboardRow.findMany).mockImplementation(async (args) => candidates.filter((row) => (args?.where?.id as { in: string[] }).in.includes(row.rowId)).map((row) => ({ id: row.rowId, rowData: row.rowData, occurredAt: row.occurredAt })) as never);
    vi.mocked(prisma.productionScheduleProgress.upsert).mockImplementation(async (args) => {
      if (args.where.csvDashboardRowId === 'row-0') throw new Error('Transaction expired waiting for lock');
      return {} as never;
    });
    await expect(service.sync({ candidates })).rejects.toThrow('CSV progress sync failed for 1 rows');
    expect(prisma.$transaction).toHaveBeenCalledTimes(103);
    expect(prisma.dueManagementOutcomeEvent.create).toHaveBeenCalledTimes(249);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { csvDashboardRowId: 'row-249' } }));
  });
  it('takes no mail critical lock for ordinary rows', async () => {
    await service.sync({ candidates: [candidate] });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(prisma.$executeRaw).mock.calls[0][0])).not.toContain('fkojunst-status-mail-critical');
  });
  it('restarts with critical before logical locks when a first split appeared while waiting', async () => {
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mockResolvedValueOnce([]).mockResolvedValue([
      { fseiban: '', fhincd: '', fsigencd: '', fkojun: '', pieces: [{ id: 'piece' }] }
    ] as never);
    await service.sync({ candidates: [candidate] });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const locks = vi.mocked(prisma.$executeRaw).mock.calls.map((args) => String(args[0]));
    expect(locks[0]).not.toContain('fkojunst-status-mail-critical');
    expect(locks[1]).toContain('fkojunst-status-mail-critical');
    expect(locks[2]).toContain('logical_locks');
    expect(synchronizeSessakuPieceSources).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
  });

});
