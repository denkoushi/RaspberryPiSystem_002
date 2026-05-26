import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import { ProductionScheduleCsvIngestExternalCompletionSyncService } from '../production-schedule-csv-ingest-external-completion-sync.service.js';

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

  it('applyPostIngestFromSnapshot is a compatibility no-op and does not write to DB', async () => {
    const prismaMock = {
      $transaction: vi.fn(),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot();

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applyPostIngestFromSnapshot ignores canonical keys because schedule disappearance completion is disabled', async () => {
    const prismaMock = {
      $transaction: vi.fn(),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      canonicalScheduleDisappearanceCurrentKeys: ['210\t588\tP1'],
      referenceAt: new Date('2026-05-09T12:00:00.000Z'),
    });

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        referenceAt: new Date('2026-05-09T12:00:00.000Z'),
        canonicalScheduleDisappearanceDistinctKeys: 1,
        disappearedDistinctKeys: 0,
      },
      '[ProductionScheduleCsvIngestExternalCompletionSync] schedule CSV disappearance completion sync disabled by policy'
    );
  });

  it('applyPostIngestFromSnapshot accepts deprecated currentWinnerKeys alias without applying disappearance completion', async () => {
    const prismaMock = {
      $transaction: vi.fn(),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      currentWinnerKeys: ['210\t588\tP1'],
    });

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applyPostIngestFromSnapshot does not treat empty canonical keys as an error anymore', async () => {
    const prismaMock = { $transaction: vi.fn() };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      canonicalScheduleDisappearanceCurrentKeys: [],
    });

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applyPostIngestFromSnapshot does not query winner keys when currentWinnerKeys is omitted', async () => {
    const prismaMock = { $transaction: vi.fn() };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot();

    expect(r).toEqual({ skipped: false, disappearedDistinctKeys: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
