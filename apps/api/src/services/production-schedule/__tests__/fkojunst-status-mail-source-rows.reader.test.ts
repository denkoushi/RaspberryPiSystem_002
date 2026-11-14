import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  buildFkojunstMailPruneBucketWhere,
  FKOJUNST_MAIL_PRUNE_BUCKET_COUNT,
  FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS
} from '../fkojunst-status-mail-superseded-prune.service.js';

import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY
} from '../../production-schedule/fkojunst-status-mail-source-rows.reader.js';

describe('fetchFkojunstStatusMailSourceRowsOrdered reader visibility', () => {
  it('adds a parameterized bucket WHERE without changing visibility, projection or order', async () => {
    const queryRaw = vi.fn(async (_query: Prisma.Sql) => []);
    await fetchFkojunstStatusMailSourceRowsOrdered({ $queryRaw: queryRaw } as never);
    await fetchFkojunstStatusMailSourceRowsOrdered({ $queryRaw: queryRaw } as never, {
      where: buildFkojunstMailPruneBucketWhere(7)
    });
    const full = queryRaw.mock.calls[0][0];
    const bucketed = queryRaw.mock.calls[1][0];
    const fullSql = full.strings.join('?');
    const bucketSql = bucketed.strings.join('?');
    expect(bucketSql.split('    WHERE')[0]).toBe(fullSql.split('    WHERE')[0]);
    expect(bucketSql.split('ORDER BY')[1]).toBe(fullSql.split('ORDER BY')[1]);
    expect(bucketSql).toContain(`ir."status" = 'COMPLETED'::"ImportStatus"`);
    expect(bucketSql).toContain('md5(split_part(reverse(btrim(');
    expect(bucketSql).toContain(`COALESCE(r."rowData"->>'FSEZONO', ''), ?`);
    expect(bucketSql).toContain('chr(9), 1)');
    expect(bucketSql).toContain('::bit(32)::bigint % ?) = ?');
    expect(bucketed.values).toEqual([...full.values, FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS, FKOJUNST_MAIL_PRUNE_BUCKET_COUNT, 7]);
  });

  it('uses exactly the ECMAScript trim characters, including Unicode whitespace', () => {
    expect(FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS).toHaveLength(25);
    for (const char of FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS) expect(char.trim()).toBe('');
    expect(`${FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS}KEY${FKOJUNST_MAIL_PRUNE_TRIM_CHARACTERS}`.trim()).toBe('KEY');
    // ECMAScript trim does not remove these characters.
    expect('\u0085\u180e\u200b'.trim()).toBe('\u0085\u180e\u200b');
  });

  it.each([-1, 32, 0.5, NaN])('rejects invalid bucket %s', (bucket) => {
    expect(() => buildFkojunstMailPruneBucketWhere(bucket)).toThrow('invalid bucket');
  });

  it('does not treat rows tied to a PROCESSING ingest run as authoritative', async () => {
    const queryRaw = vi.fn(async (_query: Prisma.Sql) => [
      {
        id: 'visible-row',
        FKOJUN: '210',
        FKOTEICD: '035',
        FSEZONO: 'PCR0001',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-06-10T01:00:00Z',
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
        updatedAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceIngestRunCompletedAt: new Date('2026-06-10T01:00:00.000Z')
      },
    ]);

    const rows = await fetchFkojunstStatusMailSourceRowsOrdered({
      $queryRaw: queryRaw,
    } as never);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]?.[0];
    expect(sql?.strings.join(' ')).toContain('r."sourceIngestRunId" IS NULL');
    expect(sql?.strings.join(' ')).toContain(`ir."status" = 'COMPLETED'::"ImportStatus"`);
    const sqlText = sql?.strings.join(' ') ?? '';
    expect(sqlText).toContain('ORDER BY');
    expect(sqlText).toContain('r."rowData"->>\'FKOJUN\'');
    let orderCursor = sqlText.indexOf('ORDER BY');
    for (const fragment of FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY) {
      const fragmentIndex = sqlText.indexOf(fragment, orderCursor);
      expect(fragmentIndex).toBeGreaterThan(orderCursor);
      orderCursor = fragmentIndex;
    }
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'visible-row',
        rowData: {
          FKOJUN: '210',
          FKOTEICD: '035',
          FSEZONO: 'PCR0001',
          FKOJUNST: 'S',
          FUPDTEDT: '2026-06-10T01:00:00Z'
        },
        sourceIngestRunCompletedAt: new Date('2026-06-10T01:00:00.000Z')
      })
    ]);
  });
});
