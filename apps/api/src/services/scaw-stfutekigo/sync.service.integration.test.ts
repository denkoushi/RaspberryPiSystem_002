import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureScawStfutekigoDashboard } from './dashboard.definition.js';
import type { ScawStfutekigoEnrichmentAdapter } from './enrichment.js';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from './constants.js';
import { ScawStfutekigoSyncService } from './sync.service.js';

const runDbTests = process.env.RUN_SCAW_DB_INTEGRATION === '1';
const client = new PrismaClient();

function sourceRow(nonconformityNo: string, manufacturingOrderNo: string, remarks: string) {
  return {
    originDepartmentCode: 'A01',
    originDepartmentName: '加工',
    quantity: '0.2',
    remarks,
    nonconformityContent: '寸法不良',
    correctiveContent1: '是正1',
    correctiveContent2: '是正2',
    dispositionContent: '再加工',
    discoveredOn: '2026/09/02 10:30:00',
    sourceUpdatedOn: '2026-09-02T12:34:56+09:00',
    manufacturingOrderNo,
    sourceSeiban: `S-${manufacturingOrderNo}`,
    qaIssueCode: `QA-${nonconformityNo}`,
    nonconformityNo,
    dispositionOn: '2026-09-03',
    drawingNumber: `D-${nonconformityNo}`,
  };
}

const enrichmentAdapter: ScawStfutekigoEnrichmentAdapter = {
  async enrich(orderNumbers) {
    return new Map(
      orderNumbers.map((orderNo) => [
        orderNo,
        {
          partNumber: `PART-${orderNo}`,
          partName: `部品-${orderNo}`,
          machineName: `機種-${orderNo}`,
          resolvedSeiban: `S-${orderNo}`,
          enrichmentStatus: 'RESOLVED' as const,
          enrichedAt: new Date('2026-09-02T02:00:00.000Z'),
        },
      ])
    );
  },
};

async function createCompletedRun(
  id: string,
  receivedAt: Date,
  rows: ReadonlyArray<ReturnType<typeof sourceRow>>
) {
  const completedAt = new Date(receivedAt.getTime() + 60_000);
  await client.csvDashboardIngestRun.create({
    data: {
      id,
      csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
      status: 'COMPLETED',
      rowsProcessed: rows.length,
      sourceReceivedAt: receivedAt,
      startedAt: receivedAt,
      completedAt,
    },
  });
  await client.csvDashboardRow.createMany({
    data: rows.map((rowData, index) => ({
      csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
      occurredAt: completedAt,
      rowData: rowData as Prisma.InputJsonObject,
      sourceIngestRunId: id,
      sourceIngestRunStartedAt: receivedAt,
      sourceRowOrdinal: index + 1,
    })),
  });
}

describe.runIf(runDbTests)('ScawStfutekigoSyncService PostgreSQL integration', () => {
  beforeAll(async () => {
    await ensureScawStfutekigoDashboard(client);
  });

  beforeEach(async () => {
    await client.scawStfutekigoRevision.deleteMany();
    await client.scawStfutekigoCurrent.deleteMany();
    await client.csvDashboardRow.deleteMany({ where: { csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID } });
    await client.csvDashboardIngestRun.deleteMany({ where: { csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID } });
  });

  afterAll(async () => {
    if (runDbTests) {
      await client.scawStfutekigoRevision.deleteMany();
      await client.scawStfutekigoCurrent.deleteMany();
      await client.csvDashboard.delete({ where: { id: SCAW_STFUTEKIGO_DASHBOARD_ID } }).catch(() => undefined);
      await client.$disconnect();
    }
  });

  it('keeps current/history correct across duplicate, unchanged, changed, absent, reappeared and older snapshots', async () => {
    const service = new ScawStfutekigoSyncService(client, enrichmentAdapter);
    await createCompletedRun('run-1', new Date('2026-09-01T01:00:00.000Z'), [
      sourceRow('N-1', 'O1', '先頭行'),
      sourceRow('N-2', 'O2', '案件2'),
      sourceRow('N-1', 'O1', '末尾行'),
    ]);
    const first = await service.syncFromScawStfutekigoDashboard({ ingestRunId: 'run-1' });
    expect(first).toMatchObject({ rowsScanned: 3, uniqueRows: 2, duplicateRows: 1, created: 2 });
    expect(await client.scawStfutekigoRevision.count()).toBe(2);
    expect((await client.scawStfutekigoCurrent.findUniqueOrThrow({ where: { nonconformityNo: 'N-1' } })).remarks).toBe(
      '末尾行'
    );
    expect((await client.csvDashboardIngestRun.findUniqueOrThrow({ where: { id: 'run-1' } })).rowsSkipped).toBe(1);
    expect(await client.csvDashboardRow.count({ where: { sourceIngestRunId: 'run-1' } })).toBe(0);

    await createCompletedRun('run-2', new Date('2026-09-02T01:00:00.000Z'), [
      sourceRow('N-1', 'O1', '末尾行'),
      sourceRow('N-2', 'O2', '案件2'),
    ]);
    expect(await service.syncFromScawStfutekigoDashboard({ ingestRunId: 'run-2' })).toMatchObject({ updated: 0 });
    expect(await client.scawStfutekigoRevision.count()).toBe(2);

    await createCompletedRun('run-3', new Date('2026-09-03T01:00:00.000Z'), [
      sourceRow('N-1', 'O1', '変更後'),
    ]);
    expect(await service.syncFromScawStfutekigoDashboard({ ingestRunId: 'run-3' })).toMatchObject({
      updated: 1,
      disappeared: 1,
    });
    expect(await client.scawStfutekigoRevision.count()).toBe(3);
    expect(
      (await client.scawStfutekigoCurrent.findUniqueOrThrow({ where: { nonconformityNo: 'N-2' } }))
        .isPresentInLatestSnapshot
    ).toBe(false);

    await createCompletedRun('run-4', new Date('2026-09-04T01:00:00.000Z'), [sourceRow('N-2', 'O2', '案件2')]);
    expect(await service.syncFromScawStfutekigoDashboard({ ingestRunId: 'run-4' })).toMatchObject({ reactivated: 1 });
    expect(await client.scawStfutekigoRevision.count()).toBe(3);

    await createCompletedRun('run-old', new Date('2026-09-02T12:00:00.000Z'), [
      sourceRow('N-1', 'O1', '古い内容'),
    ]);
    expect(await service.syncFromScawStfutekigoDashboard({ ingestRunId: 'run-old' })).toMatchObject({
      skippedAsOlder: true,
    });
    const active = await client.scawStfutekigoCurrent.findMany({
      where: { isPresentInLatestSnapshot: true },
      select: { nonconformityNo: true },
    });
    expect(active).toEqual([{ nonconformityNo: 'N-2' }]);
  });

  it('projects and cleans an 8,188-row full snapshot without duplicate current keys', async () => {
    const rows = Array.from({ length: 8_188 }, (_, index) =>
      sourceRow(`BULK-${String(index).padStart(5, '0')}`, `O${String(index).padStart(5, '0')}`, '一括検証')
    );
    await createCompletedRun('run-bulk', new Date('2026-09-02T01:00:00.000Z'), rows);
    const result = await new ScawStfutekigoSyncService(client, enrichmentAdapter).syncFromScawStfutekigoDashboard({
      ingestRunId: 'run-bulk',
    });
    expect(result).toMatchObject({ rowsScanned: 8_188, uniqueRows: 8_188, created: 8_188 });
    expect(await client.scawStfutekigoCurrent.count()).toBe(8_188);
    expect(await client.scawStfutekigoRevision.count()).toBe(8_188);
    expect(await client.csvDashboardRow.count({ where: { sourceIngestRunId: 'run-bulk' } })).toBe(0);
  }, 120_000);
});
