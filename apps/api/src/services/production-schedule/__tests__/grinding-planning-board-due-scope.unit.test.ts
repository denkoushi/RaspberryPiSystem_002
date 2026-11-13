import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';
import { getGrindingPlanningBoardDueScope, updateGrindingPlanningBoardDueScope } from '../grinding-planning-board-due-scope.service.js';

const mocks = vi.hoisted(() => {
  const table = () => ({ findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), deleteMany: vi.fn() });
  return { original: vi.fn(), tx: {
    $transaction: vi.fn(), csvDashboardRow: table(), productionScheduleGrindingPlanningBoardState: table(),
    productionScheduleGrindingPlanningBoardDueScope: table(), productionScheduleGrindingPlanningBoardOverride: table(),
    productionScheduleDScheduleMinutes: table(), productionScheduleSeibanProcessingDueDate: table(), productionScheduleSeibanDueDate: table(),
    productionScheduleRowNote: table(), productionScheduleOrderSupplement: table(), productionScheduleProgress: table(),
    productionScheduleExternalCompletion: table(), productionSchedulePartProcessingType: table()
  } };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.tx }));
vi.mock('../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: vi.fn(), lockState: vi.fn() }));
vi.mock('../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({ readLeaderboardShellSnapshotGenerationToken: vi.fn().mockResolvedValue('generation') }));
vi.mock('../due-management-location-scope-adapter.service.js', () => ({ getDueManagementSeibanDetailWithScope: mocks.original }));
vi.mock('../due-date-writeback.service.js', () => ({ listSeibanRowIdsForWriteback: vi.fn().mockResolvedValue(['row']), isValidDueDateText: () => true }));
vi.mock('../sessaku-pieces/piece-key.js', async (original) => ({
  ...await original<typeof import('../sessaku-pieces/piece-key.js')>(), readSessakuPieceSets: vi.fn().mockResolvedValue(new Map()),
  acquireSessakuPieceLogicalLocks: vi.fn()
}));
vi.mock('../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: vi.fn() }));

const row = { id: 'row', updatedAt: null, rowData: { FSEIBAN: 'S', FHINCD: 'P', FSIGENCD: '305', FKOJUN: '1' } };
const itemKey = buildGrindingPlanningBoardRowItemId(row.rowData);
const excelChangedAt = new Date('2026-11-08');
const params = { siteKey: 'site', fseiban: 'S' };
const override = (overrideDueDateSetAt: Date | null, cleared = false) => ({
  id: 'override', itemKey, version: 1, overrideDueDateSetAt, overrideDueDate: cleared ? null : new Date('2026-11-02'),
  dueDateCleared: cleared, alternateRank: 5
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.tx.csvDashboardRow.findMany.mockResolvedValue([row]);
  mocks.tx.productionScheduleDScheduleMinutes.findUnique.mockResolvedValue({ partsCompleteDate: new Date('2026-11-13'), excelChangedAt });
  mocks.tx.productionScheduleGrindingPlanningBoardDueScope.findMany.mockResolvedValue([]);
  mocks.tx.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([]);
  mocks.tx.productionScheduleOrderSupplement.findMany.mockResolvedValue([{ csvDashboardRowId: 'row', plannedEndDate: new Date('2026-11-20') }]);
  mocks.original.mockResolvedValue({ fseiban: 'S', dueDate: new Date('2026-11-13'), parts: [{
    fhincd: 'P', processingType: 'processing', plannedStartDate: null, plannedEndDate: new Date('2026-11-20'), processes: [{ rowId: 'row' }]
  }] });
});

describe('scope due override priority', () => {
  it.each([
    { name: 'newer manual date', timestamp: new Date('2026-11-09'), cleared: false, expected: '2026-11-02' },
    { name: 'legacy date with Excel', timestamp: null, cleared: false, expected: '2026-11-13' },
    { name: 'Excel changed after clear', timestamp: new Date('2026-11-07'), cleared: true, expected: '2026-11-13' },
    { name: 'newer clear', timestamp: new Date('2026-11-09'), cleared: true, expected: '2026-11-20' }
  ])('$name', async ({ timestamp, cleared, expected }) => {
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([override(timestamp, cleared)]);
    mocks.tx.productionScheduleGrindingPlanningBoardDueScope.findMany.mockResolvedValue([{ scopeKind: 'processing', processingType: 'processing', scopeKey: 'processing:processing', dueDate: null, version: 1 }]);
    const snapshot = await getGrindingPlanningBoardDueScope(params);
    expect(snapshot.alternate.parts[0].effectiveDueDate).toBe(expected);
  });

  it('writes the timestamp when the requested date equals an inactive stored date and resets the effective-date rank', async () => {
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([override(null)]);
    const before = await getGrindingPlanningBoardDueScope(params);
    const started = Date.now();
    await updateGrindingPlanningBoardDueScope({ ...params, request: {
      scope: { kind: 'seiban' }, dueDate: '2026-11-02', sourceGenerationToken: before.sourceGenerationToken, scopeRevision: before.scopeRevision
    } });
    const write = mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls[0][0];
    for (const data of [write.create, write.update]) {
      expect(data.overrideDueDateSetAt.getTime()).toBeGreaterThanOrEqual(started);
      expect(data.overrideDueDate).toEqual(new Date('2026-11-02'));
      expect(data.alternateRank).toBeNull();
    }
  });

  it('clearing a processing due stores no timestamp so the Excel date applies again', async () => {
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([override(new Date('2026-11-09'))]);
    mocks.tx.productionSchedulePartProcessingType.findMany.mockResolvedValue([{ fhincd: 'P', processingType: 'processing' }]);
    const before = await getGrindingPlanningBoardDueScope(params);
    await updateGrindingPlanningBoardDueScope({ ...params, request: {
      scope: { kind: 'processing', processingType: 'processing' }, dueDate: '', sourceGenerationToken: before.sourceGenerationToken, scopeRevision: before.scopeRevision
    } });
    const write = mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls[0][0];
    for (const data of [write.create, write.update]) expect(data.overrideDueDateSetAt).toBeNull();
  });
});
