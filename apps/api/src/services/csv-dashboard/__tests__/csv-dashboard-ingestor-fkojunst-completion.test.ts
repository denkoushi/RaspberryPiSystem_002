import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../../production-schedule/constants.js';

const {
  acquireFkojunstStatusMailCriticalTransactionLock,
  applyFkojunstDeferredRowUpdatesInTransaction,
  deleteDuplicateLosersForKeys,
  findCsvDashboardRowsByDataHashes,
  prismaCsvDashboardFindUnique,
  prismaCsvDashboardIngestRunCreate,
  prismaCsvDashboardIngestRunUpdate,
  prismaCsvDashboardUpdate,
  prismaCsvDashboardRowCreateMany,
  prismaTransaction,
} = vi.hoisted(() => ({
  acquireFkojunstStatusMailCriticalTransactionLock: vi.fn(async () => undefined),
  applyFkojunstDeferredRowUpdatesInTransaction: vi.fn(async () => undefined),
  deleteDuplicateLosersForKeys: vi.fn(async () => ({ deletedCount: 0 })),
  findCsvDashboardRowsByDataHashes: vi.fn(),
  prismaCsvDashboardFindUnique: vi.fn(),
  prismaCsvDashboardIngestRunCreate: vi.fn(),
  prismaCsvDashboardIngestRunUpdate: vi.fn(),
  prismaCsvDashboardUpdate: vi.fn(),
  prismaCsvDashboardRowCreateMany: vi.fn(),
  prismaTransaction: vi.fn(),
}));

vi.mock('../../production-schedule/fkojunst-status-mail-critical-lock.js', () => ({
  acquireFkojunstStatusMailCriticalTransactionLock,
}));

vi.mock('../fkojunst-status-mail-ingest-publication.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fkojunst-status-mail-ingest-publication.js')>();
  return {
    ...actual,
    applyFkojunstDeferredRowUpdatesInTransaction,
  };
});

vi.mock('../csv-dashboard-existing-rows-by-hash.reader.js', () => ({
  findCsvDashboardRowsByDataHashes,
}));

vi.mock('../csv-dashboard-dedup-cleanup.service.js', () => ({
  CsvDashboardDedupCleanupService: class MockCsvDashboardDedupCleanupService {
    deleteDuplicateLosersForKeys = deleteDuplicateLosersForKeys;
  },
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboard: {
      findUnique: prismaCsvDashboardFindUnique,
      update: prismaCsvDashboardUpdate,
    },
    csvDashboardIngestRun: {
      create: prismaCsvDashboardIngestRunCreate,
      update: prismaCsvDashboardIngestRunUpdate,
    },
    csvDashboardRow: {
      createMany: prismaCsvDashboardRowCreateMany,
    },
    $transaction: prismaTransaction,
  },
}));

import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';
import { FKOJUNST_STATUS_MAIL_COMPLETION_TX_TIMEOUT_MS } from '../fkojunst-status-mail-ingest-publication.js';

const FK_DASHBOARD = {
  id: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  name: 'FKOJUNST_Status',
  enabled: true,
  ingestMode: 'DEDUP',
  dedupKeyColumns: ['FKojun', 'FKoteicd', 'FSezono'],
  dateColumnName: 'FUPDTEDT',
  columnDefinitions: [
    {
      internalName: 'FKojun',
      displayName: 'FKojun',
      csvHeaderCandidates: ['FKojun'],
      dataType: 'string',
    },
    {
      internalName: 'FKoteicd',
      displayName: 'FKoteicd',
      csvHeaderCandidates: ['FKoteicd'],
      dataType: 'string',
    },
    {
      internalName: 'FSezono',
      displayName: 'FSezono',
      csvHeaderCandidates: ['FSezono'],
      dataType: 'string',
    },
    {
      internalName: 'FUPDTEDT',
      displayName: 'FUPDTEDT',
      csvHeaderCandidates: ['FUPDTEDT'],
      dataType: 'date',
    },
  ],
};

describe('CsvDashboardIngestor FKOJUNST completion transaction boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaCsvDashboardFindUnique.mockResolvedValue(FK_DASHBOARD);
    prismaCsvDashboardIngestRunCreate.mockResolvedValue({
      id: 'run-processing',
      startedAt: new Date('2026-06-18T00:00:00.000Z'),
    });
    prismaCsvDashboardRowCreateMany.mockResolvedValue({ count: 0 });
    findCsvDashboardRowsByDataHashes.mockResolvedValue([
      {
        id: 'existing-row-1',
        dataHash: 'a52dd81bfd5e4e66d96b9f598382f6cbf8c5c3897654e6ae9055e03620fcf38e',
        rowData: {
          FKojun: 'A',
          FKoteicd: 'B',
          FSezono: 'C',
          FUPDTEDT: '2026/6/10',
        },
        occurredAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceIngestRunId: 'run-completed',
        sourceRowOrdinal: 10,
        sourceIngestRunStartedAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceIngestRun: {
          status: 'COMPLETED',
          completedAt: new Date('2026-06-10T01:00:00.000Z'),
        },
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);

    prismaTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>, _options?: unknown) => {
      const tx = {
        csvDashboardIngestRun: { update: prismaCsvDashboardIngestRunUpdate },
        csvDashboard: { update: prismaCsvDashboardUpdate },
        csvDashboardRow: {
          update: vi.fn(async () => ({ id: 'existing-row-1' })),
        },
      };
      return callback(tx);
    });
    prismaCsvDashboardIngestRunUpdate.mockResolvedValue({ id: 'run-processing' });
    prismaCsvDashboardUpdate.mockResolvedValue({ id: FK_DASHBOARD.id });
    applyFkojunstDeferredRowUpdatesInTransaction.mockResolvedValue(undefined);
  });

  it('applies deferred row updates only inside the completion transaction', async () => {
    const ingestor = new CsvDashboardIngestor();
    const csvContent = ['FKojun,FKoteicd,FSezono,FUPDTEDT', 'A,B,C,2026/6/10'].join('\n');

    await ingestor.ingestFromGmail(
      PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      csvContent,
      'message-1',
      'FKOJUNST_Status',
      '/tmp/fkojunst.csv'
    );

    expect(applyFkojunstDeferredRowUpdatesInTransaction).toHaveBeenCalledTimes(1);
    expect(applyFkojunstDeferredRowUpdatesInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ csvDashboardRow: expect.any(Object) }),
      [expect.objectContaining({ id: 'existing-row-1', sourceIngestRunId: 'run-processing' })]
    );
    expect(deleteDuplicateLosersForKeys).toHaveBeenCalledTimes(1);
  });

  it('acquires the shared advisory lock inside the completion transaction', async () => {
    const ingestor = new CsvDashboardIngestor();
    const csvContent = ['FKojun,FKoteicd,FSezono,FUPDTEDT', 'A,B,C,2026/6/10'].join('\n');

    await ingestor.ingestFromGmail(PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID, csvContent, 'message-1');

    expect(acquireFkojunstStatusMailCriticalTransactionLock).toHaveBeenCalledTimes(1);
    expect(acquireFkojunstStatusMailCriticalTransactionLock).toHaveBeenCalledWith(
      expect.objectContaining({ csvDashboardRow: expect.any(Object) })
    );
  });

  it('uses an extended completion timeout when deferred updates exist', async () => {
    const ingestor = new CsvDashboardIngestor();
    const csvContent = ['FKojun,FKoteicd,FSezono,FUPDTEDT', 'A,B,C,2026/6/10'].join('\n');

    await ingestor.ingestFromGmail(PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID, csvContent, 'message-1');

    expect(prismaTransaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: FKOJUNST_STATUS_MAIL_COMPLETION_TX_TIMEOUT_MS,
      maxWait: 15_000,
    });
  });

  it('leaves reader-visible row content unchanged when the completion transaction fails', async () => {
    applyFkojunstDeferredRowUpdatesInTransaction.mockRejectedValueOnce(new Error('Transaction already closed'));

    const ingestor = new CsvDashboardIngestor();
    const csvContent = ['FKojun,FKoteicd,FSezono,FUPDTEDT', 'A,B,C,2026/6/10'].join('\n');

    await expect(
      ingestor.ingestFromGmail(PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID, csvContent, 'message-1')
    ).rejects.toThrow('Transaction already closed');

    expect(applyFkojunstDeferredRowUpdatesInTransaction).toHaveBeenCalledTimes(1);
    expect(prismaCsvDashboardIngestRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-processing' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Transaction already closed',
      }),
    });
  });

  it('can complete a retry after a failed completion attempt', async () => {
    applyFkojunstDeferredRowUpdatesInTransaction
      .mockRejectedValueOnce(new Error('Transaction already closed'))
      .mockResolvedValueOnce(undefined);

    const ingestor = new CsvDashboardIngestor();
    const csvContent = ['FKojun,FKoteicd,FSezono,FUPDTEDT', 'A,B,C,2026/6/10'].join('\n');

    await expect(
      ingestor.ingestFromGmail(PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID, csvContent, 'message-1')
    ).rejects.toThrow('Transaction already closed');

    const result = await ingestor.ingestFromGmail(
      PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      csvContent,
      'message-1'
    );

    expect(result.ingestRunId).toBe('run-processing');
    expect(applyFkojunstDeferredRowUpdatesInTransaction).toHaveBeenCalledTimes(2);
  });
});
