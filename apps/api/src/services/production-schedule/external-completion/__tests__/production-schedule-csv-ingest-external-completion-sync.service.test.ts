import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import * as noncQuery from '../production-schedule-nonc-window-winner-key.query.js';
import * as keyQuery from '../production-schedule-winner-logical-key.query.js';
import * as repo from '../fkojunst-external-completion-sync.repository.js';
import { ProductionScheduleCsvIngestExternalCompletionSyncService } from '../production-schedule-csv-ingest-external-completion-sync.service.js';

vi.mock('../production-schedule-winner-logical-key.query.js', () => ({
  queryWinnerLogicalKeys: vi.fn(),
}));

vi.mock('../production-schedule-nonc-window-winner-key.query.js', () => ({
  queryNonCScheduleDisappearanceCandidateKeys: vi.fn(),
}));

vi.mock('../fkojunst-external-completion-sync.repository.js', () => ({
  replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync: vi.fn(),
}));

function mockReconcileService() {
  return {
    reconcileStaleAssignments: vi.fn().mockResolvedValue({ scanned: 0, released: 0 }),
  };
}

describe('ProductionScheduleCsvIngestExternalCompletionSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  it('capturePreIngestSnapshot is deprecated no-op (no DB writes)', async () => {
    const prismaMock = { $transaction: vi.fn() };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    await svc.capturePreIngestSnapshot();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applyPostIngestFromSnapshot uses nonC window mother set minus current keys', async () => {
    vi.mocked(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).mockResolvedValue([
      '200\t021\tP1',
      '210\t588\tP1',
    ]);
    vi.mocked(keyQuery.queryWinnerLogicalKeys).mockResolvedValueOnce(['210\t588\tP1']);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
      orderAssignmentReconciliationService: mockReconcileService() as never,
    });

    const r = await svc.applyPostIngestFromSnapshot();

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 1 });
    expect(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).toHaveBeenCalledTimes(1);
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).toHaveBeenCalledWith({ t: true }, [
      '200\t021\tP1',
    ]);
  });

  it('applyPostIngestFromSnapshot uses currentWinnerKeys when provided', async () => {
    vi.mocked(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).mockResolvedValue([
      '200\t021\tP1',
      '210\t588\tP1',
    ]);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
      orderAssignmentReconciliationService: mockReconcileService() as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      canonicalScheduleDisappearanceCurrentKeys: ['210\t588\tP1'],
      referenceAt: new Date('2026-05-09T12:00:00.000Z'),
    });

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 1 });
    expect(keyQuery.queryWinnerLogicalKeys).not.toHaveBeenCalled();
    expect(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).toHaveBeenCalledWith(expect.anything(), {
      referenceAt: new Date('2026-05-09T12:00:00.000Z'),
    });
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).toHaveBeenCalledWith({ t: true }, [
      '200\t021\tP1',
    ]);
  });

  it('applyPostIngestFromSnapshot accepts deprecated currentWinnerKeys alias', async () => {
    vi.mocked(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).mockResolvedValue([
      '200\t021\tP1',
      '210\t588\tP1',
    ]);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
      orderAssignmentReconciliationService: mockReconcileService() as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      currentWinnerKeys: ['210\t588\tP1'],
    });

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 1 });
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).toHaveBeenCalledWith({ t: true }, [
      '200\t021\tP1',
    ]);
  });

  it('applyPostIngestFromSnapshot skips when ingest batch has no canonical keys (empty canonicalScheduleDisappearanceCurrentKeys)', async () => {
    const prismaMock = { $transaction: vi.fn() };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      canonicalScheduleDisappearanceCurrentKeys: [],
    });

    expect(r).toEqual({ skipped: true, reason: 'empty_schedule_csv' });
    expect(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).not.toHaveBeenCalled();
  });

  it('applyPostIngestFromSnapshot skips when DB reports no winner keys and currentWinnerKeys is omitted', async () => {
    vi.mocked(keyQuery.queryWinnerLogicalKeys).mockResolvedValue([]);
    const prismaMock = { $transaction: vi.fn() };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot();

    expect(r).toEqual({ skipped: true, reason: 'empty_schedule_csv' });
    expect(noncQuery.queryNonCScheduleDisappearanceCandidateKeys).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
