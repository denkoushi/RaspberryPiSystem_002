import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, createRun, updateRun, createMany, transaction, pieceSets } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(),
  pieceSets: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleSessakuPieceSet: { findMany: pieceSets },
    csvDashboard: { findUnique },
    csvDashboardIngestRun: { create: createRun, update: updateRun },
    csvDashboardRow: { createMany },
    $transaction: transaction,
  },
}));

import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';

describe('CsvDashboardIngestor APPEND header-only CSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      id: 'dashboard-1',
      name: 'Test dashboard',
      enabled: true,
      ingestMode: 'APPEND',
      dedupKeyColumns: [],
      dateColumnName: null,
      columnDefinitions: [{
        internalName: 'h1',
        displayName: 'h1',
        csvHeaderCandidates: ['h1'],
        dataType: 'string',
      }],
    });
    createRun.mockResolvedValue({ id: 'run-1', startedAt: new Date() });
    updateRun.mockResolvedValue({ id: 'run-1' });
    createMany.mockResolvedValue({ count: 0 });
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ csvDashboardIngestRun: { update: updateRun } })
    );
  });

  it('completes with zero rows when the header matches', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'h1\n')).resolves.toMatchObject({
      rowsProcessed: 0, rowsAdded: 0, rowsSkipped: 0,
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'COMPLETED', rowsProcessed: 0 }),
    });
  });

  it('fails with CSV_HEADER_MISMATCH when the header does not match', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'wrong\n')).rejects.toMatchObject({
      code: 'CSV_HEADER_MISMATCH',
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('processes one data row after the header', async () => {
    await expect(new CsvDashboardIngestor().ingestFromGmail('dashboard-1', 'h1\nv1\n')).resolves.toMatchObject({
      rowsProcessed: 1, rowsAdded: 1, rowsSkipped: 0,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ rowData: { h1: 'v1' } })],
    });
  });
  it.each([{ sets: [] }, { sets: [{ fseiban: 'SEIBAN01', fhincd: '', fsigencd: '', fkojun: '', pieces: [] }] }])('keeps production APPEND on createMany with only the legacy completion tx for %j', async ({ sets }) => {
    const dashboard = await findUnique();
    findUnique.mockResolvedValue({ ...dashboard, id: PRODUCTION_SCHEDULE_DASHBOARD_ID, columnDefinitions: ['ProductNo', 'FSEIBAN'].map((name) => ({ internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string' })) });
    pieceSets.mockResolvedValueOnce(sets);
    await new CsvDashboardIngestor().ingestFromGmail(PRODUCTION_SCHEDULE_DASHBOARD_ID, 'ProductNo,FSEIBAN\n0000000123,SEIBAN01\n');
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(pieceSets).toHaveBeenCalledTimes(1);
  });

});
