import { describe, expect, it, vi } from 'vitest';
const pipeline = vi.hoisted(() => ({
  loadFkojunstMailSourceRows: vi.fn().mockResolvedValue({ scanned: 1, normalizedRows: [{}], skippedInvalidStatus: 0, skippedUnparseableDate: 0, rowsRevision: '1' }),
  dedupeFkojunstMailRowsByLatest: vi.fn().mockReturnValue([{}]),
  resolveFkojunstMailWinnerIdByKey: vi.fn().mockResolvedValue(new Map()),
  buildFkojunstMailReplacementCreateInputs: vi.fn().mockReturnValue({ matched: 0, unmatched: 0, createInputs: [] }),
  runFkojunstMailReplacementTransaction: vi.fn(), runFkojunstMailClearTransaction: vi.fn()
}));
vi.mock('../fkojunst-status-mail-sync.pipeline.js', () => pipeline);
vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../leaderboard/leaderboard-process-change-residual.materialization.js', () => ({
  buildProcessChangeResidualStrongEvidenceFromDedupedRows: vi.fn(), buildProcessChangeResidualEvidenceCreateInputs: vi.fn().mockReturnValue([])
}));
import { ProductionScheduleFkojunstMailStatusSyncService } from '../fkojunst-status-mail-sync.service.js';
describe('mail sync external completion publication', () => {
  it.each([false, true])('does not repeat publication already completed inside the mail tx (pieces=%s)', async (pieces) => {
    const result = { scanned: 1, normalized: 1, matched: 0, unmatched: 0, skippedInvalidStatus: 0, skippedUnparseableDate: 0, upserted: 0, pruned: 0 };
    pipeline.runFkojunstMailReplacementTransaction.mockResolvedValue({ ...result, ...(pieces ? { externalCompletionSynced: true } : {}) });
    const external = { syncFromDedupedStatusMailRows: vi.fn().mockResolvedValue({ skipped: false }) };
    const assignments = { reconcileStaleAssignments: vi.fn() };
    const service = new ProductionScheduleFkojunstMailStatusSyncService(external as never, assignments as never);
    expect(await service.syncFromStatusMailDashboard()).toEqual(result);
    expect(pipeline.runFkojunstMailReplacementTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ missingStandardHoursMailRows: [{}] }));
    expect(external.syncFromDedupedStatusMailRows).toHaveBeenCalledTimes(pieces ? 0 : 1);
    expect(assignments.reconcileStaleAssignments).toHaveBeenCalledTimes(pieces ? 1 : 0);
  });
});
