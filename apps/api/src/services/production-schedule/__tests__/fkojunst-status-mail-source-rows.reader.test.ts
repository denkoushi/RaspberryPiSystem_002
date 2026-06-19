import { describe, expect, it, vi } from 'vitest';

import {
  fetchFkojunstStatusMailSourceRowsOrdered,
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY
} from '../../production-schedule/fkojunst-status-mail-source-rows.reader.js';

describe('fetchFkojunstStatusMailSourceRowsOrdered reader visibility', () => {
  it('does not treat rows tied to a PROCESSING ingest run as authoritative', async () => {
    const queryRaw = vi.fn(async () => [
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
