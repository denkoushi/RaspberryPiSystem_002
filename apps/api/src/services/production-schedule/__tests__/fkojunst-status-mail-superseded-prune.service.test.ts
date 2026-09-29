import { describe, expect, it, vi } from 'vitest';

import {
  planFkojunstMailSupersededPrune,
  runFkojunstMailSupersededPrune
} from '../fkojunst-status-mail-superseded-prune.service.js';

import type { FkojunstStatusMailSourceRow } from '../fkojunst-status-mail-source-rows.reader.js';

function mailRow(
  id: string,
  data: { FKOJUN: string; FKOTEICD: string; FSEZONO: string; FKOJUNST: string; FUPDTEDT: string },
  createdAt = '2026-09-01T00:00:00.000Z'
): FkojunstStatusMailSourceRow {
  return { id, rowData: data, createdAt: new Date(createdAt), sourceRowOrdinal: null };
}

const key = { FKOJUN: '210', FKOTEICD: '1', FSEZONO: 'PCR-1' };

describe('planFkojunstMailSupersededPrune', () => {
  it('deletes only rows superseded by a later FUPDTEDT for the same key', () => {
    const plan = planFkojunstMailSupersededPrune({
      rowsRevision: '10',
      sourceRows: [
        mailRow('old', { ...key, FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }, '2026-08-15T00:00:00.000Z'),
        mailRow('new', { ...key, FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000' }),
        mailRow('other', { ...key, FKOTEICD: '2', FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' })
      ]
    });

    expect(plan.deleteIds).toEqual(['old']);
    expect(plan.winners).toBe(2);
    expect(plan.deleteCountByCreatedMonth).toEqual({ '2026-08': 1 });
    expect(plan.rowsRevision).toBe('10');
  });

  it('keeps rows that do not normalize (missing key) because dedupe never looks at them', () => {
    const plan = planFkojunstMailSupersededPrune({
      rowsRevision: '10',
      sourceRows: [
        mailRow('no-key', { ...key, FSEZONO: '', FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }),
        mailRow('only', { ...key, FKOJUNST: 'S', FUPDTEDT: '2026-09-02T08:00:00.000' })
      ]
    });

    expect(plan.deleteIds).toEqual([]);
    expect(plan.scanned).toBe(2);
    expect(plan.normalized).toBe(1);
  });
});

describe('runFkojunstMailSupersededPrune', () => {
  function clientReturning(rows: unknown[]) {
    const queryRaw = vi.fn((query: { strings?: readonly string[] }) => {
      const text = query.strings?.join('') ?? '';
      if (text.includes('"CsvDashboardRawRevision"')) return Promise.resolve([{ revision: 10n }]);
      if (text.includes('pg_constraint')) return Promise.resolve([]);
      return Promise.resolve(rows);
    });
    return { $queryRaw: queryRaw, $transaction: vi.fn() };
  }

  const projectedRows = [
    { id: 'old', FKOJUN: '210', FKOTEICD: '1', FSEZONO: 'PCR-1', FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000', createdAt: new Date('2026-08-15T00:00:00.000Z') },
    { id: 'new', FKOJUN: '210', FKOTEICD: '1', FSEZONO: 'PCR-1', FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000', createdAt: new Date('2026-09-01T00:00:00.000Z') }
  ];

  it('dry-run reports candidates and never opens a delete transaction', async () => {
    const client = clientReturning(projectedRows);
    const syncService = { syncFromStatusMailDashboard: vi.fn() };

    const result = await runFkojunstMailSupersededPrune({ mode: 'dry-run', client: client as never, syncService });

    expect(result).toMatchObject({ status: 'dry_run', deleteCandidates: 1, winners: 1, referencingRows: 0 });
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(syncService.syncFromStatusMailDashboard).not.toHaveBeenCalled();
  });

  it('execute does nothing when candidates exceed the per-run limit', async () => {
    const client = clientReturning(projectedRows);
    const syncService = { syncFromStatusMailDashboard: vi.fn() };

    const result = await runFkojunstMailSupersededPrune({
      mode: 'execute',
      maxDelete: 0,
      client: client as never,
      syncService
    });

    expect(result.status).toBe('over_limit');
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(syncService.syncFromStatusMailDashboard).not.toHaveBeenCalled();
  });

  it('execute deletes inside the locked transaction and re-syncs afterwards', async () => {
    const client = clientReturning(projectedRows);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: client.$queryRaw,
      csvDashboardRow: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }
    };
    client.$transaction.mockImplementation(async (work: (t: typeof tx) => Promise<unknown>) => work(tx));
    const syncService = { syncFromStatusMailDashboard: vi.fn().mockResolvedValue({}) };

    const result = await runFkojunstMailSupersededPrune({ mode: 'execute', maxDelete: 10, client: client as never, syncService });

    expect(result).toMatchObject({ status: 'deleted', deleted: 1 });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.csvDashboardRow.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old'] }, csvDashboardId: 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e' }
    });
    expect(syncService.syncFromStatusMailDashboard).toHaveBeenCalledTimes(1);
  });

  it('execute refuses to delete when the raw revision moved after planning', async () => {
    const client = clientReturning(projectedRows);
    let revisionReads = 0;
    const txQueryRaw = vi.fn(() => {
      revisionReads += 1;
      return Promise.resolve([{ revision: 11n }]);
    });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: txQueryRaw,
      csvDashboardRow: { deleteMany: vi.fn() }
    };
    client.$transaction.mockImplementation(async (work: (t: typeof tx) => Promise<unknown>) => work(tx));

    await expect(
      runFkojunstMailSupersededPrune({ mode: 'execute', maxDelete: 10, client: client as never, syncService: { syncFromStatusMailDashboard: vi.fn() } })
    ).rejects.toThrow(/revision changed/);
    expect(revisionReads).toBe(1);
    expect(tx.csvDashboardRow.deleteMany).not.toHaveBeenCalled();
  });
});
