import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../../lib/logger.js';
import * as keyQuery from '../production-schedule-winner-logical-key.query.js';
import * as repo from '../fkojunst-external-completion-sync.repository.js';
import * as snapshotRepo from '../schedule-csv-logical-key-snapshot.repository.js';
import { ProductionScheduleCsvIngestExternalCompletionSyncService } from '../production-schedule-csv-ingest-external-completion-sync.service.js';

vi.mock('../production-schedule-winner-logical-key.query.js', () => ({
  queryWinnerLogicalKeys: vi.fn(),
}));

vi.mock('../fkojunst-external-completion-sync.repository.js', () => ({
  replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync: vi.fn(),
}));

vi.mock('../schedule-csv-logical-key-snapshot.repository.js', () => ({
  loadScheduleCsvIngestSnapshotKeys: vi.fn(),
  replaceScheduleCsvIngestLogicalKeySnapshot: vi.fn(),
}));

describe('ProductionScheduleCsvIngestExternalCompletionSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  it('capturePreIngestSnapshot stores current winner keys', async () => {
    vi.mocked(keyQuery.queryWinnerLogicalKeys).mockResolvedValue(['200\t021\tP1']);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    await svc.capturePreIngestSnapshot();

    expect(snapshotRepo.replaceScheduleCsvIngestLogicalKeySnapshot).toHaveBeenCalledWith({ t: true }, ['200\t021\tP1']);
  });

  it('applyPostIngestFromSnapshot computes disappearance and refreshes snapshot', async () => {
    vi.mocked(snapshotRepo.loadScheduleCsvIngestSnapshotKeys).mockResolvedValue(['200\t021\tP1', '210\t588\tP1']);
    vi.mocked(keyQuery.queryWinnerLogicalKeys).mockResolvedValueOnce(['210\t588\tP1']);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot();

    expect(r).toEqual({ disappearedDistinctKeys: 1 });
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).toHaveBeenCalledWith({ t: true }, [
      '200\t021\tP1',
    ]);
    expect(snapshotRepo.replaceScheduleCsvIngestLogicalKeySnapshot).toHaveBeenCalledWith({ t: true }, ['210\t588\tP1']);
  });

  it('applyPostIngestFromSnapshot uses currentWinnerKeys from ingest result when provided', async () => {
    vi.mocked(snapshotRepo.loadScheduleCsvIngestSnapshotKeys).mockResolvedValue(['200\t021\tP1', '210\t588\tP1']);

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: { t: true }) => Promise<void>) => {
        await fn({ t: true } as never);
      }),
    };

    const svc = new ProductionScheduleCsvIngestExternalCompletionSyncService({
      prismaClient: prismaMock as never,
    });

    const r = await svc.applyPostIngestFromSnapshot({
      currentWinnerKeys: ['210\t588\tP1'],
    });

    expect(r).toEqual({ disappearedDistinctKeys: 1 });
    expect(keyQuery.queryWinnerLogicalKeys).not.toHaveBeenCalled();
    expect(repo.replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync).toHaveBeenCalledWith({ t: true }, [
      '200\t021\tP1',
    ]);
    expect(snapshotRepo.replaceScheduleCsvIngestLogicalKeySnapshot).toHaveBeenCalledWith({ t: true }, ['210\t588\tP1']);
  });
});
