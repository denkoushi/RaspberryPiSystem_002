import { readFile } from 'node:fs/promises';

import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { fhincdMatchKeyFromRowDataExpr } from '../purchase-fhincd-match-sql.js';
import { PurchaseOrderLookupSyncService } from '../purchase-order-lookup-sync.service.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  csvDashboardIngestRun: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
} }));

const BOM = String.fromCharCode(0xfeff);
const HEADER = 'FKOBAINO,FHINCD,FSEIBAN,FKOBAIHINMEI,FKENSAOKSU,FKOBAIST,FUPDTEDT';

function csv(lines: string[]): string {
  return `${BOM}${[HEADER, ...lines].join('\n')}\n`;
}

/** Collects the Prisma.Sql values of every row tuple passed to $executeRaw. */
function executedChunks(): unknown[][] {
  return vi.mocked(prisma.$executeRaw).mock.calls.map((call) => {
    const sql = call[1] as unknown as Prisma.Sql;
    return sql.values;
  });
}

describe('PurchaseOrderLookupSyncService.syncFromFkobainoDashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.csvDashboardIngestRun.findUnique).mockResolvedValue({
      csvDashboardId: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID,
      csvFilePath: '/data/fkobaino.csv',
    } as never);
  });

  it('returns 404 for an ingest run of another dashboard', async () => {
    vi.mocked(prisma.csvDashboardIngestRun.findUnique).mockResolvedValue({ csvDashboardId: 'other', csvFilePath: '/x.csv' } as never);
    await expect(new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: 'run-1' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown ingest run and 400 when the CSV original is missing', async () => {
    const service = new PurchaseOrderLookupSyncService();
    vi.mocked(prisma.csvDashboardIngestRun.findUnique).mockResolvedValueOnce(null);
    await expect(service.syncFromFkobainoDashboard({ ingestRunId: 'run-x' })).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(prisma.csvDashboardIngestRun.findUnique).mockResolvedValueOnce({ csvDashboardId: PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID, csvFilePath: null } as never);
    await expect(service.syncFromFkobainoDashboard({ ingestRunId: 'run-y' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips invalid purchase order numbers and does not execute SQL for an empty result', async () => {
    vi.mocked(readFile).mockResolvedValue(csv(['12345,P,S,name,1,,', 'ABCDEFGHIJ,P,S,name,1,,']) as never);
    const result = await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: 'run-1' });
    expect(result).toEqual({ scanned: 2, inserted: 0, upserted: 0, skippedStale: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps only the newest duplicate per (order, seiban, FHINCD match key)', async () => {
    vi.mocked(readFile).mockResolvedValue(csv([
      '0005000001,MD100-001,S1,newer,5,a,2026-09-29T10:00:00',
      '0005000001,MD100-002,S1,older,3,a,2026-09-28T10:00:00',
      '0005000002,MD200,S1,other,1,,',
    ]) as never);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(2 as never);

    const result = await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: 'run-1' });

    const values = executedChunks();
    expect(values).toHaveLength(1);
    expect(values[0]).toContain('newer');
    expect(values[0]).not.toContain('older');
    expect(values[0]).toContain('A'); // FKOBAIST upper-cased
    expect(readFile).toHaveBeenCalledWith('/data/fkobaino.csv', 'utf-8');
    // The collapsed duplicate is not counted: upserted + skippedStale equals the deduplicated row count (2).
    expect(result).toEqual({ scanned: 3, inserted: 2, upserted: 2, skippedStale: 0 });
  });

  it('reports rows the database did not write as skippedStale', async () => {
    vi.mocked(readFile).mockResolvedValue(csv([
      '0005000001,P1,S1,a,1,,2026-09-29T10:00:00',
      '0005000002,P2,S1,b,1,,2026-09-29T10:00:00',
      '0005000003,P3,S1,c,1,,2026-09-29T10:00:00',
    ]) as never);
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
    const result = await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: 'run-1' });
    expect(result).toEqual({ scanned: 3, inserted: 1, upserted: 1, skippedStale: 2 });
  });

  it('writes in chunks of 500 rows', async () => {
    const lines = Array.from({ length: 501 }, (_, i) => `${String(5000000000 + i)},P${i},S,n,1,,`);
    vi.mocked(readFile).mockResolvedValue(csv(lines) as never);
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(500 as never).mockResolvedValueOnce(1 as never);
    const result = await new PurchaseOrderLookupSyncService().syncFromFkobainoDashboard({ ingestRunId: 'run-1' });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(executedChunks()[1]).toContain('5000000500');
    expect(executedChunks()[1]).not.toContain('5000000499');
    expect(result).toEqual({ scanned: 501, inserted: 501, upserted: 501, skippedStale: 0 });
  });
});

describe('fhincdMatchKeyFromRowDataExpr', () => {
  it('embeds a safe alias in the SQL expression', () => {
    expect(fhincdMatchKeyFromRowDataExpr('r').sql).toContain('"r"."rowData"->>\'FHINCD\'');
  });

  it.each(['r; DROP TABLE x', '1abc', 'a"b', ''])('rejects the unsafe alias %j', (alias) => {
    expect(() => fhincdMatchKeyFromRowDataExpr(alias)).toThrow(/Invalid SQL row alias/);
  });
});
