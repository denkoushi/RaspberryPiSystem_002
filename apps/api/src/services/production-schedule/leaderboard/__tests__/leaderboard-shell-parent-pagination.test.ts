import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prefix: vi.fn(), continuation: vi.fn(), hydrate: vi.fn(), legacy: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleOrderSplit: { findMany: mocks.legacy }
} }));
vi.mock('../../production-schedule-query/filters.js', () => ({
  prepareProductionScheduleDashboardFilters: vi.fn(async () => ({ kind: 'ready', queryWhere: Prisma.empty,
    leaderboardExpansionWhere: Prisma.empty, siteScopedGlobalRankLocation: 'site' }))
}));
vi.mock('../leaderboard-row-selection.service.js', () => ({
  fetchLeaderboardShellMergedPrefixRows: mocks.prefix,
  fetchLeaderboardShellRowsContinuationChunk: mocks.continuation
}));
vi.mock('../leaderboard-shell-hydrate.service.js', () => ({ fetchLeaderboardScheduleHydratedRowsOrderedByIds: mocks.hydrate }));
vi.mock('../leaderboard-shell-snapshot-generation.js', () => ({ resolveLeaderboardShellSnapshotGenerationToken: vi.fn(async () => 'parent-v2') }));

import { listLeaderboardShellProductionScheduleRows, listLeaderboardShellContinuationProductionScheduleRows } from '../../production-schedule-query/leaderboard-shell.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard-shell-snapshot.store.js';

const parentA = { id: '11111111-1111-4111-8111-111111111111', seibanJoinKey: 'A',
  occurredAt: new Date('2026-11-05'), updatedAt: null, rowData: { FSIGENSHOYORYO: '100', FSIGENCD: '080' },
  processingOrder: 1, globalRank: null, note: 'parent note', processingType: null, dueDate: null,
  plannedQuantity: 5, plannedStartDate: null, plannedEndDate: null };
const parentB = { ...parentA, id: '22222222-2222-4222-8222-222222222222', processingOrder: 2 };
const params = { page: 1, pageSize: 1, queryText: '', productNos: [], resourceCds: ['080'],
  assignedOnlyCds: [], hasNoteOnly: false, hasDueDateOnly: false, allowResourceOnly: true, locationKey: 'site' };

describe('parent-only shell pagination', () => {
  it('keeps one parent per page with retained legacy records and resumes by parent ids', async () => {
    mocks.legacy.mockResolvedValue([{ parentCsvDashboardRowId: parentA.id, splitQuantity: 2 }]);
    mocks.prefix.mockResolvedValue({ mergedPrefix: [parentA], mergeFullyCompleted: false });
    mocks.continuation.mockResolvedValue({ rows: [parentB], mergeFullyCompleted: true });
    mocks.hydrate.mockResolvedValue([parentB]);
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const options = { snapshotStore, leaderboardMaterializedBaseWhere: Prisma.sql`TRUE` };
    const shell = await listLeaderboardShellProductionScheduleRows(params, options);
    expect(shell.rows).toHaveLength(1);
    expect(shell.rows[0]).toMatchObject({ id: parentA.id, plannedQuantity: 5, rowData: { FSIGENSHOYORYO: '100' }, note: 'parent note' });
    expect(shell).toMatchObject({ nextCursor: 1, hasMore: true });
    const next = await listLeaderboardShellContinuationProductionScheduleRows({ ...params, chunkSize: 1,
      cursor: shell.nextCursor, snapshotId: shell.snapshotId }, options);
    expect(next.rows.map((row) => row.id)).toEqual([parentB.id]);
    expect(next).toMatchObject({ nextCursor: 2, hasMore: false });
    expect(mocks.continuation.mock.calls[0][0].excludeRowIds).toEqual([parentA.id]);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it('recalculates snapshot continuation board due dates using the requested SCAW source', async () => {
    const scawDueDate = new Date('2026-11-20T00:00:00.000Z');
    const excelDueDate = new Date('2026-11-25T00:00:00.000Z');
    mocks.prefix.mockResolvedValue({ mergedPrefix: [parentA], mergeFullyCompleted: false });
    mocks.continuation.mockResolvedValue({ rows: [parentB], mergeFullyCompleted: true });
    mocks.hydrate.mockResolvedValue([{ ...parentB, plannedEndDate: scawDueDate,
      excelDueDate, boardDueDate: excelDueDate }]);
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const options = { snapshotStore, leaderboardMaterializedBaseWhere: Prisma.sql`TRUE` };
    const scawParams = { ...params, dueSource: 'scaw' as const };
    const shell = await listLeaderboardShellProductionScheduleRows(scawParams, options);
    const next = await listLeaderboardShellContinuationProductionScheduleRows({ ...scawParams, chunkSize: 1,
      cursor: shell.nextCursor, snapshotId: shell.snapshotId }, options);

    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]).toMatchObject({ id: parentB.id, boardDueDate: scawDueDate, excelDueDate });
    expect(mocks.hydrate).toHaveBeenLastCalledWith(expect.objectContaining({ orderedRowIds: [parentB.id] }));
  });
});
