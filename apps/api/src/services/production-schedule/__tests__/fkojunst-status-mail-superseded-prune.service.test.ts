import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { logger } from '../../../lib/logger.js';
import {
  buildFkojunstMailStatusKey,
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest
} from '../fkojunst-status-mail-sync.pipeline.js';

import { ProductionScheduleFkojunstMailStatusSyncService } from '../fkojunst-status-mail-sync.service.js';

vi.mock('../fkojunst-status-mail-sync.service.js', () => ({
  ProductionScheduleFkojunstMailStatusSyncService: vi.fn()
}));

import {
  FKOJUNST_MAIL_PRUNE_BUCKET_COUNT,
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

// SQL と同じ FSEZONO 射影 + MD5 のバケットを返す reader モック（全行を返さない）。
function bucketOf(fsezono: string): number {
  const reversedSuffix = [...fsezono.trim()].reverse().join('').split('\t')[0];
  return parseInt(createHash('md5').update(reversedSuffix).digest('hex').slice(0, 8), 16) % FKOJUNST_MAIL_PRUNE_BUCKET_COUNT;
}

function pair(prefix: string, productNo: string): FkojunstStatusMailSourceRow[] {
  return [
    mailRow(`${prefix}-old`, { ...key, FSEZONO: productNo, FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }),
    mailRow(`${prefix}-new`, { ...key, FSEZONO: productNo, FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000' })
  ];
}

function fixture(rows: FkojunstStatusMailSourceRow[]) {
  let revision = 10n;
  const deletedIds: string[] = [];
  const bucketsRead: number[] = [];
  const queryRaw = vi.fn(async (query: { strings: readonly string[]; values: unknown[] }) => {
    const text = query.strings.join('');
    if (text.includes('"CsvDashboardRawRevision"')) return [{ revision }];
    if (text.includes('pg_constraint')) return [];
    const bucket = query.values.at(-1) as number;
    bucketsRead.push(bucket);
    return rows.filter((row) => bucketOf((row.rowData as typeof key).FSEZONO) === bucket)
      .map(({ rowData, ...row }) => ({ ...row, ...rowData as object }));
  });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: queryRaw,
    csvDashboardRow: {
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        deletedIds.push(...args.where.id.in);
        revision += 1n;
        return { count: args.where.id.in.length };
      })
    }
  };
  const client = { $queryRaw: queryRaw, $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)) };
  return { client, tx, deletedIds, bucketsRead, bumpRevision: () => { revision += 1n; } };
}

const execute = (client: ReturnType<typeof fixture>['client'], extra = {}) =>
  runFkojunstMailSupersededPrune({ mode: 'execute', maxDelete: 10, pauseMs: 0, client: client as never, ...extra });

const productInBucket = (bucket: number): string => {
  for (let i = 0; ; i += 1) if (bucketOf(`PCR-${i}`) === bucket) return `PCR-${i}`;
};

describe('runFkojunstMailSupersededPrune', () => {
  it('bucketed deleteIds match an unpartitioned plan including trim, resource case, ties and invalid dates', async () => {
    const sourceRows = [
      ...Array.from({ length: 80 }, (_, i) => pair(`p${i}`, `PCR-${i}`)).flat(),
      mailRow('space-old', { FKOJUN: '\ufeff 210\t', FKOTEICD: '\u00a0straße\u3000', FSEZONO: '\u2028CASE\ufeff', FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }),
      mailRow('space-new', { FKOJUN: '210', FKOTEICD: 'STRASSE', FSEZONO: 'CASE', FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000' }),
      // 論理キーはタブ連結なので、異なる triple が同じキーになる既存の挙動も保つ。
      mailRow('tab-old', { ...key, FKOJUN: '210\tABC', FKOTEICD: 'D', FSEZONO: 'E', FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }),
      mailRow('tab-new', { ...key, FKOJUN: '210', FKOTEICD: 'ABC', FSEZONO: 'D\tE', FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000' }),
      ...pair('tie', 'TIE').map((row) => ({ ...row, rowData: { ...row.rowData as object, FUPDTEDT: '2026-09-01T08:00:00.000' } })),
      ...pair('bad-date', 'BAD-DATE').map((row, i) => ({ ...row, sourceRowOrdinal: i, sourceIngestRunCompletedAt: new Date('2026-09-01Z'), rowData: { ...row.rowData as object, FUPDTEDT: 'invalid' } })),
      mailRow('missing', { ...key, FSEZONO: '', FKOJUNST: 'S', FUPDTEDT: '' }),
      ...pair('case-sensitive', 'CASE-sensitive'),
      ...pair('distinct', 'case-sensitive')
    ];
    const plan = planFkojunstMailSupersededPrune({ sourceRows, rowsRevision: '10' });
    const { client, deletedIds, bucketsRead } = fixture(sourceRows);
    const result = await execute(client, { maxDelete: 1000 });
    expect(new Set(deletedIds)).toEqual(new Set(plan.deleteIds));
    expect(deletedIds).toContain('space-old');
    expect(deletedIds).toContain('tab-old');
    expect(result).toMatchObject({ status: 'deleted', deleted: plan.deleteIds.length, hasRemaining: false, scanned: sourceRows.length, winners: plan.winners });
    expect(bucketsRead).toEqual(Array.from({ length: FKOJUNST_MAIL_PRUNE_BUCKET_COUNT }, (_, i) => i));
    expect(ProductionScheduleFkojunstMailStatusSyncService).not.toHaveBeenCalled();
  });

  it('dry-run counts all buckets and references without deleting, ignoring maxDelete', async () => {
    const { client, tx, bucketsRead } = fixture([...pair('a', productInBucket(0)), ...pair('b', productInBucket(31))]);
    const baseQuery = client.$queryRaw.getMockImplementation()!;
    client.$queryRaw.mockImplementation(async (query) => {
      const text = query.strings.join('');
      if (text.includes('pg_constraint')) return [{ tableName: '"Ref"', columnName: 'rawId' }] as never;
      if (text.includes('COUNT(*)')) return [{ count: 1n }] as never;
      return baseQuery(query);
    });
    const result = await runFkojunstMailSupersededPrune({ mode: 'dry-run', maxDelete: 0, client: client as never });
    expect(result).toMatchObject({ status: 'dry_run', deleteCandidates: 2, scanned: 4, maxBucketScanned: 2, referencingRows: 2, hasRemaining: true });
    expect(bucketsRead).toHaveLength(32);
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(tx.csvDashboardRow.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps an oversized key intact and returns hasRemaining', async () => {
    const { client, deletedIds } = fixture([...pair('a', 'PCR-1'), ...pair('b', 'PCR-1')]);
    const result = await execute(client, { maxDelete: 2, chunkSize: 1 });
    expect(result).toMatchObject({ status: 'deleted', deleted: 0, hasRemaining: true, deleteCandidates: 3, reason: expect.stringContaining('limit') });
    expect(deletedIds).toHaveLength(0);
  });

  it.each([
    { maxDelete: 1, chunkSize: 1, interrupt: false, expectedDeleted: 1, hasRemaining: true },
    { maxDelete: 2, chunkSize: 1, interrupt: false, expectedDeleted: 1, hasRemaining: true },
    { maxDelete: 3, chunkSize: 1, interrupt: false, expectedDeleted: 3, hasRemaining: true },
    { maxDelete: 4, chunkSize: 1, interrupt: false, expectedDeleted: 4, hasRemaining: false },
    { maxDelete: 4, chunkSize: 3, interrupt: false, expectedDeleted: 4, hasRemaining: false },
    { maxDelete: 4, chunkSize: 1, interrupt: true, expectedDeleted: 1, hasRemaining: true },
    { maxDelete: 4, chunkSize: 3, interrupt: true, expectedDeleted: 3, hasRemaining: true }
  ])('preserves whole loser groups and winners: %j', async ({ maxDelete, chunkSize, interrupt, expectedDeleted, hasRemaining }) => {
    const product = productInBucket(0);
    const pathological = [
      { ...mailRow('a', { ...key, FSEZONO: product, FKOJUNST: 'S', FUPDTEDT: '2026-09-01T08:00:00.000' }),
        sourceRowOrdinal: 1, sourceIngestRunStartedAt: new Date('2026-09-01Z'), sourceIngestRunCompletedAt: new Date('2026-09-01Z') },
      mailRow('b', { ...key, FSEZONO: product, FKOJUNST: 'S', FUPDTEDT: 'invalid' }),
      mailRow('c', { ...key, FSEZONO: product, FKOJUNST: 'C', FUPDTEDT: '2026-09-02T08:00:00.000' })
    ];
    const otherPair = (prefix: string, resource: string) => pair(prefix, product).map((row) => ({
      ...row, rowData: { ...row.rowData as object, FKOTEICD: resource }
    }));
    // 別キーを敗者の間にも挟み、読込順の連続区間ではなく論理キーでまとめることを確認する。
    const sourceRows = [...otherPair('first', '2'), pathological[0], ...otherPair('last', '3'), ...pathological.slice(1)];
    const winnersOf = (rows: FkojunstStatusMailSourceRow[]) => dedupeFkojunstMailRowsByLatest(
      collectFkojunstMailNormalizedRowsFromSourceRows(rows).normalizedRows
    );
    expect(winnersOf(pathological).map((row) => row.sourceRowId)).toEqual(['c']);
    expect(winnersOf(pathological.slice(1)).map((row) => row.sourceRowId)).toEqual(['b']);
    const originalWinners = winnersOf(sourceRows);
    const originalWinnerIds = new Set(originalWinners.map((row) => row.sourceRowId));
    const losersByKey = new Map<string, string[]>();
    for (const row of collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows).normalizedRows) {
      if (originalWinnerIds.has(row.sourceRowId)) continue;
      const statusKey = buildFkojunstMailStatusKey(row);
      losersByKey.set(statusKey, [...(losersByKey.get(statusKey) ?? []), row.sourceRowId]);
    }
    const { client, tx, deletedIds, bumpRevision } = fixture(sourceRows);
    const assertIntact = () => {
      const removed = new Set(deletedIds);
      for (const group of losersByKey.values()) {
        const count = group.filter((id) => removed.has(id)).length;
        expect([0, group.length]).toContain(count);
      }
      expect(new Map(winnersOf(sourceRows.filter((row) => !removed.has(row.id)))
        .map((row) => [buildFkojunstMailStatusKey(row), row.sourceRowId])))
        .toEqual(new Map(originalWinners.map((row) => [buildFkojunstMailStatusKey(row), row.sourceRowId])));
    };
    const originalDelete = tx.csvDashboardRow.deleteMany.getMockImplementation()!;
    tx.csvDashboardRow.deleteMany.mockImplementation(async (args) => {
      const result = await originalDelete(args);
      assertIntact();
      return result;
    });
    let transactions = 0;
    client.$transaction.mockImplementation(async (work) => {
      if (interrupt && ++transactions === 2) bumpRevision();
      return work(tx);
    });
    const result = await execute(client, { maxDelete, chunkSize });
    expect(result).toMatchObject({ status: interrupt ? 'stopped' : 'deleted', deleted: expectedDeleted, hasRemaining });
    assertIntact();
    if (expectedDeleted >= 3) {
      expect(tx.csvDashboardRow.deleteMany.mock.calls.some(([args]) =>
        args.where.id.in.includes('a') && args.where.id.in.includes('b')
      )).toBe(true);
    }
  });

  it('limits across buckets, deleting each before reading the next and following revision bumps', async () => {
    const { client, tx, bucketsRead, deletedIds } = fixture([...pair('a', productInBucket(0)), ...pair('b', productInBucket(1))]);
    const originalDelete = tx.csvDashboardRow.deleteMany.getMockImplementation()!;
    tx.csvDashboardRow.deleteMany.mockImplementation(async (args) => {
      expect(bucketsRead).toEqual([0]);
      return originalDelete(args);
    });
    const result = await execute(client, { maxDelete: 1 });
    expect(result).toMatchObject({ status: 'deleted', deleted: 1, hasRemaining: true });
    expect(deletedIds).toEqual(['a-old']);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('deletes everything below the limit with lock, dashboard condition and a pause between chunks', async () => {
    const { client, tx } = fixture([...pair('a', productInBucket(0)), ...pair('b', productInBucket(1))]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await execute(client, { chunkSize: 1, pauseMs: 5, sleep })).toMatchObject({ status: 'deleted', deleted: 2, hasRemaining: false });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.csvDashboardRow.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a-old'] }, csvDashboardId: 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e' } });
  });

  it('returns no remaining candidates when the count equals the limit exactly', async () => {
    const { client } = fixture(pair('a', productInBucket(0)));
    expect(await execute(client, { maxDelete: 1 })).toMatchObject({ status: 'deleted', deleted: 1, hasRemaining: false });
  });

  it('does not delete with a zero limit', async () => {
    const { client } = fixture(pair('a', productInBucket(0)));
    expect(await execute(client, { maxDelete: 0 })).toMatchObject({ deleted: 0, hasRemaining: true });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('returns nothing_to_delete when no losers exist', async () => {
    const { client } = fixture(pair('a', 'PCR-1').slice(1));
    expect(await execute(client)).toMatchObject({ status: 'nothing_to_delete', hasRemaining: false });
  });

  it('stops before deleting if revision changes after the bucket was read', async () => {
    const { client, tx, bumpRevision } = fixture(pair('a', productInBucket(0)));
    client.$transaction.mockImplementation(async (work) => { bumpRevision(); return work(tx); });
    expect(await execute(client)).toMatchObject({ status: 'stopped', deleted: 0, hasRemaining: true, reason: expect.stringContaining('revision changed') });
    expect(tx.csvDashboardRow.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps committed chunks when a later chunk sees another change', async () => {
    const otherKey = pair('b', 'PCR-1').map((row) => ({ ...row, rowData: { ...row.rowData as object, FKOTEICD: '2' } }));
    const { client, tx, bumpRevision } = fixture([...pair('a', 'PCR-1'), ...otherKey]);
    let transactions = 0;
    client.$transaction.mockImplementation(async (work) => {
      if (++transactions === 2) bumpRevision();
      return work(tx);
    });
    expect(await execute(client, { chunkSize: 1 })).toMatchObject({ status: 'stopped', deleted: 1, hasRemaining: true });
    expect(tx.csvDashboardRow.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('stops between buckets if an ingest intervenes', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const { client, tx, bumpRevision, bucketsRead } = fixture([...pair('a', productInBucket(0)), ...pair('b', productInBucket(1))]);
    client.$transaction.mockImplementation(async (work) => {
      const result = await work(tx);
      bumpRevision();
      return result;
    });
    expect(await execute(client)).toMatchObject({ status: 'stopped', deleted: 1, hasRemaining: true });
    expect(bucketsRead).toEqual([0]);
    expect(warn).toHaveBeenCalledWith(
      { deleted: 1, reason: expect.stringContaining('revision changed') },
      '[FkojunstMailSupersededPrune] stopped before finishing'
    );
    warn.mockRestore();
  });

  it('stops without deleting when candidates are referenced', async () => {
    const { client, tx } = fixture(pair('a', productInBucket(0)));
    const baseQuery = client.$queryRaw.getMockImplementation()!;
    client.$queryRaw.mockImplementation(async (query) => {
      const text = query.strings.join('');
      if (text.includes('pg_constraint')) return [{ tableName: '"Ref"', columnName: 'rawId' }] as never;
      if (text.includes('COUNT(*)')) return [{ count: 1n }] as never;
      return baseQuery(query);
    });
    expect(await execute(client)).toMatchObject({ status: 'stopped', deleted: 0, reason: expect.stringContaining('reference') });
    expect(tx.csvDashboardRow.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a delete count mismatch inside the transaction', async () => {
    const { client, tx } = fixture(pair('a', productInBucket(0)));
    tx.csvDashboardRow.deleteMany.mockResolvedValue({ count: 0 });
    await expect(execute(client)).rejects.toThrow('delete count mismatch');
  });
});
