import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveLocation: vi.fn(async () => 'assignment-site'),
  list: vi.fn(async (params: unknown) => params),
  board: vi.fn(async (params: { listParamsBase: unknown }) => params.listParamsBase)
}));
vi.mock('../resolve-assignment-location-key.js', () => ({ resolveProductionScheduleAssignmentLocationKey: mocks.resolveLocation }));
vi.mock('../../../../services/production-schedule/production-schedule-query.service.js', () => ({
  listLeaderboardShellProductionScheduleRows: mocks.list,
  listLeaderboardShellContinuationProductionScheduleRows: mocks.list,
  countProductionScheduleDashboardVisibleRowsFromListFilters: mocks.list,
  decorateLeaderboardShellRowsForKiosk: vi.fn()
}));
vi.mock('../../../../services/production-schedule/leaderboard/leaderboard-composite-board.service.js', () => ({
  fetchLeaderboardCompositeBoardShell: mocks.board,
  continueLeaderboardCompositeBoard: mocks.board
}));
vi.mock('../../../../services/production-schedule/leaderboard/leaderboard-labor-metadata.service.js', () => ({ fetchLeaderboardBoardLaborMetadata: vi.fn() }));
vi.mock('../../../../services/production-schedule/leaderboard/leaderboard-process-change-residual.materialization.js', () => ({
  materializeProcessChangeResidualStrongEvidence: vi.fn(async () => ({ keys: new Set(), rawMailRowsRevision: 'revision' }))
}));
vi.mock('../../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot-generation.js', () => ({
  readLeaderboardShellSnapshotGenerationTokenDetails: vi.fn(async () => ({ generationToken: 'generation', fkojunstStatusMailRowsRevision: 'revision' }))
}));

import { registerProductionScheduleLeaderboardPhasedReadRoutes } from '../leaderboard-phased-read.js';
import { parseLeaderboardListParams } from '../leaderboard-list-params.js';
import { parseCsvList, productionScheduleLeaderboardShellContinuationFieldsSchema, type KioskRouteDeps } from '../shared.js';

const scope = { deviceScopeKey: ' device ', siteKey: 'site', canProxyOtherDevices: true };
const uuid = '550e8400-e29b-41d4-a716-446655440000';
const cases = [
  {},
  { productNo: ' fallback ', machineName: '   ', hasNoteOnly: true },
  { q: ' query ', productNo: 'ignored', productNos: ' A,A, B, ', resourceCds: ' R1,R1, R2 ',
    resourceAssignedOnlyCds: ' R3, ,R3 ', resourceCategory: 'cutting', machineName: ' M ',
    hasNoteOnly: true, hasDueDateOnly: true, allowResourceOnly: true, completionFilter: 'incomplete', dueSource: 'scaw', targetDeviceScopeKey: ' target ' },
  { q: '   ', productNo: 'ignored', productNos: ' , ', resourceCds: ' , ', machineName: ' M ', completionFilter: 'complete' }
];

// Original handler expressions, independent of the extracted helper.
function legacyListParams(fields: Record<string, unknown>) {
  const f = fields as Record<string, string | boolean | undefined>;
  const machineName = (f.machineName as string | undefined)?.trim();
  return {
    queryText: ((f.q ?? f.productNo) as string | undefined)?.trim() ?? '',
    productNos: parseCsvList(f.productNos as string | undefined),
    machineName: machineName && machineName.length > 0 ? machineName : undefined,
    resourceCds: parseCsvList(f.resourceCds as string | undefined),
    assignedOnlyCds: parseCsvList(f.resourceAssignedOnlyCds as string | undefined),
    resourceCategory: f.resourceCategory,
    hasNoteOnly: f.hasNoteOnly === true,
    hasDueDateOnly: f.hasDueDateOnly === true,
    allowResourceOnly: f.allowResourceOnly === true,
    completionFilter: f.completionFilter ?? 'all',
    dueSource: f.dueSource ?? 'excel',
    locationKey: 'assignment-site', siteKey: scope.siteKey
  };
}

describe.each(['leaderboard-shell', 'leaderboard-shell/continue', 'leaderboard-total', 'leaderboard-board', 'leaderboard-board/continue'])('%s list preprocessing', (endpoint) => {
  beforeEach(() => vi.clearAllMocks());
  it.each(cases.map((fields, index) => [index, fields] as const))('matches original expressions: %s', async (_index, fields) => {
    const isPost = endpoint.endsWith('/continue');
    const isBoard = endpoint.startsWith('leaderboard-board');
    let handler: (request: unknown) => Promise<unknown> = async () => { throw new Error('handler not registered'); };
    const register = (path: string, _options: unknown, callback: typeof handler) => {
      if (path === `/kiosk/production-schedule/${endpoint}`) handler = callback;
    };
    await registerProductionScheduleLeaderboardPhasedReadRoutes({ get: register, post: register } as unknown as FastifyInstance, {
      requireClientDevice: async () => ({ clientDevice: {} }),
      resolveLocationScopeContext: () => scope
    } as unknown as KioskRouteDeps);
    const input: Record<string, unknown> = { ...fields, excludeRowIds: [uuid], boardResourceCds: 'R1', resourceSlices: [{ resourceCd: 'R1', hasMore: false }] };
    if (!isPost) {
      for (const key of ['hasNoteOnly', 'hasDueDateOnly', 'allowResourceOnly']) {
        if (key in input) input[key] = String(input[key]);
      }
    }
    await handler({ headers: {}, ...(isPost ? { body: input } : { query: input }) });
    const expected = legacyListParams(fields);
    const actual = isBoard ? mocks.board.mock.calls[0][0].listParamsBase : mocks.list.mock.calls[0][0];
    if (isBoard) {
      const { resourceCds: _resourceCds, ...boardExpected } = expected;
      expect(actual).toStrictEqual(boardExpected);
    } else {
      expect(actual).toMatchObject(expected);
    }
    expect(mocks.resolveLocation).toHaveBeenCalledExactlyOnceWith({
      actorDeviceScopeKey: scope.deviceScopeKey,
      actorCanProxyOtherDevices: true,
      targetDeviceScopeKey: (fields as Record<string, unknown>).targetDeviceScopeKey
    });
  });
});


describe('parseLeaderboardListParams', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(cases.map((fields, index) => [index, fields] as const))('returns the original handler values: %s', async (_index, fields) => {
    const parsed = productionScheduleLeaderboardShellContinuationFieldsSchema.parse(fields);
    expect(await parseLeaderboardListParams(parsed, scope)).toStrictEqual(legacyListParams(fields));
    expect(mocks.resolveLocation).toHaveBeenCalledExactlyOnceWith({
      actorDeviceScopeKey: scope.deviceScopeKey,
      actorCanProxyOtherDevices: scope.canProxyOtherDevices,
      targetDeviceScopeKey: parsed.targetDeviceScopeKey
    });
  });
});
