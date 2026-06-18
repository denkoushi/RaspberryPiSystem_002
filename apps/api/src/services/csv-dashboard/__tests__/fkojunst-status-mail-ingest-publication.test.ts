import { describe, expect, it, vi } from 'vitest';

import {
  applyFkojunstDeferredRowUpdatesInTransaction,
  FKOJUNST_STATUS_MAIL_DEFERRED_ROW_UPDATE_BATCH_SIZE,
  type FkojunstDeferredRowUpdate,
} from '../fkojunst-status-mail-ingest-publication.js';

function createUpdate(id: string): FkojunstDeferredRowUpdate {
  return {
    id,
    occurredAt: new Date('2026-06-18T00:00:00.000Z'),
    rowData: { FKojun: id },
    sourceIngestRunId: 'run-new',
    sourceRowOrdinal: 1,
    sourceIngestRunStartedAt: new Date('2026-06-18T00:00:00.000Z'),
  };
}

describe('fkojunst-status-mail-ingest-publication', () => {
  describe('applyFkojunstDeferredRowUpdatesInTransaction', () => {
    it('executes one batched raw update per batch of deferred rows', async () => {
      const updates = [createUpdate('row-1'), createUpdate('row-2')];
      const executeRaw = vi.fn(async () => 2);
      const tx = { $executeRaw: executeRaw };

      await applyFkojunstDeferredRowUpdatesInTransaction(tx as never, updates);

      expect(executeRaw).toHaveBeenCalledTimes(1);
      expect(executeRaw.mock.calls[0]?.[0]).toBeDefined();
    });

    it('batches large update sets', async () => {
      const batchSize = FKOJUNST_STATUS_MAIL_DEFERRED_ROW_UPDATE_BATCH_SIZE;
      const updates = Array.from({ length: batchSize + 1 }, (_, index) => createUpdate(`row-${index}`));
      const executeRaw = vi
        .fn()
        .mockResolvedValueOnce(batchSize)
        .mockResolvedValueOnce(1);
      const tx = { $executeRaw: executeRaw };

      await applyFkojunstDeferredRowUpdatesInTransaction(tx as never, updates);

      expect(executeRaw).toHaveBeenCalledTimes(2);
    });

    it('only mutates rows through the completion transaction client', async () => {
      const updates = [createUpdate('row-1')];
      const executeRaw = vi.fn(async () => 1);
      const tx = { $executeRaw: executeRaw };

      await applyFkojunstDeferredRowUpdatesInTransaction(tx as never, updates);

      expect(executeRaw).toHaveBeenCalledTimes(1);
      expect(tx).toEqual({ $executeRaw: executeRaw });
    });

    it('throws when affected row count does not match the batch size', async () => {
      const updates = [createUpdate('row-1'), createUpdate('row-2')];
      const executeRaw = vi.fn(async () => 1);
      const tx = { $executeRaw: executeRaw };

      await expect(applyFkojunstDeferredRowUpdatesInTransaction(tx as never, updates)).rejects.toThrow(
        'deferred row update count mismatch: expected 2, got 1'
      );
    });
  });
});
