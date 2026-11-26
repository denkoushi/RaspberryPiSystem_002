import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({
  raw: vi.fn(),
  pairs: vi.fn(),
  unarrived: new Set<string>(),
  outsourced: new Map<string, 'pending'>()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.raw,
  productionScheduleGrindingPlanningBoardPair: { findMany: mocks.pairs },
  productionScheduleGrindingPlanningBoardArrival: { findMany: async () => [] },
  productionScheduleGrindingPlanningBoardFirstProcessArrival: { findMany: async () => [] },
  productionScheduleDScheduleMinutes: { findMany: async () => [] },
  orderPlacementBranchState: { findMany: async () => [] }
} }));
vi.mock('./state.js', async (original) => ({
  ...await original<typeof import('./state.js')>(),
  getOrCreateState: async () => ({ version: 0, seibanOrder: ['lot'] }),
  readPlanningSnapshotGenerationDetails: async () => ({ generationToken: 'generation' }),
  isPlanningStateAlignedWithGeneration: () => true,
  boardRevision: () => 'board',
  stateOrder: () => ['lot'],
  stateUncheckedFseibans: () => []
}));
vi.mock('./schedule-source.js', async (original) => ({
  ...await original<typeof import('./schedule-source.js')>(),
  readScheduleSourceExcludedFseibans: async () => []
}));
vi.mock('../process-arrival.service.js', () => ({
  enrichRowsWithProcessArrival: async (rows: { id: string }[]) =>
    rows.map((row) => ({ ...row, arrived: !mocks.unarrived.has(row.id), isFirstProcess: false }))
}));
vi.mock('../outsourced-routing-arrival.service.js', () => ({
  findOutsourcedRoutingArrivalByItemId: async () => mocks.outsourced
}));
vi.mock('../../purchase-order-lookup/material-arrival-status.service.js', () => ({
  findMaterialArrivalStatusByPart: async () => new Map(),
  materialArrivalLookupKey: () => ''
}));

import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import { getPlanningPairSuggestions } from './pairs.js';
import { getGrindingPlanningBoard } from './read.js';

const firstPartName = '足（１）';
const secondPartName = '足（２）';
const item = (itemId: string, fhinmei: string, overrides: Partial<GrindingPlanningBoardItem> = {}) => ({
  itemId, sourceRowId: itemId, itemRevision: itemId, kind: 'row', version: 0,
  fseiban: 'lot', processOrder: '210', fhinmei, fhincd: fhinmei, productNo: itemId,
  originalResourceCd: '305', effectiveResourceCd: '305', isCompleted: false, ...overrides
} as GrindingPlanningBoardItem);
const own = item('left', firstPartName);
const other = item('right', secondPartName, { originalResourceCd: '581' });
const piece = (itemId: string) => ({ ...other, itemId, kind: 'piece' as const, parentItemId: other.itemId });

async function readFirst(counterparts: GrindingPlanningBoardItem[], options: {
  completionFilter?: 'all' | 'incomplete'; pairPieces?: GrindingPlanningBoardItem[];
} = {}) {
  const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
  const { completionFilter = 'all', pairPieces } = options;
  const includePieces = !pairPieces;
  const siteKey = 'site';
  const category = 'grinding';
  const view = 'resource';
  const items = [own, ...counterparts];
  const snapshotId = snapshotStore.create({
    siteKey, locationKey: siteKey, generationToken: 'generation', partialOrdering: false,
    filterFingerprint: JSON.stringify({ scheduleSource: 'both', excludedFseibans: [], dueSource: 'excel', siteKey,
      category, view, fseibans: ['lot'], completionFilter, includeLoad: false, includePieces }),
    orderedRowIds: items.filter((row) => completionFilter === 'all' || !row.isCompleted).map((row) => row.itemId),
    payload: { items, pairPieces, load: [], unknownRequiredMinutesCount: 0, seibanProgress: {},
      resources: ['305', '581'], resourceCategories: { '305': 'grinding', '581': 'grinding' } }
  });
  return getGrindingPlanningBoard({ siteKey, category, view, snapshotStore,
    snapshotId, cursor: 0, pageSize: 1, includeLoad: false, includePieces, completionFilter });
}

beforeEach(() => {
  mocks.raw.mockReset().mockResolvedValue([]);
  mocks.pairs.mockReset().mockResolvedValue([{ id: 'pair', firstPartName, secondPartName }]);
  mocks.unarrived.clear();
  mocks.unarrived.add(other.itemId);
  mocks.outsourced.clear();
});

describe('grinding board pair arrivals', () => {
  it('waits for an unarrived counterpart on another page without changing arrived', async () => {
    const result = await readFirst([other]);
    expect(result.items).toMatchObject([{ itemId: own.itemId, arrived: true, waitingForPair: true }]);
    expect(result.nextCursor).toBe('1');
  });

  it.each([
    ['absent from the schedule', []],
    ['another work order', [{ ...other, processOrder: '220' }]],
    ['another serial number', [{ ...other, fseiban: 'other-lot' }]],
    ['a different exact FHINMEI', [{ ...other, fhinmei: '足(2)' }]]
  ])('does not wait for a counterpart %s', async (_label, counterparts) => {
    expect((await readFirst(counterparts)).items[0]).toMatchObject({ arrived: true, waitingForPair: false });
  });

  it('does not wait when there is no registered pair', async () => {
    mocks.pairs.mockResolvedValue([]);
    expect((await readFirst([other])).items[0]).toMatchObject({ waitingForPair: false });
  });

  it('does not mark its own unarrived row as waiting', async () => {
    mocks.unarrived.add(own.itemId);
    expect((await readFirst([other])).items[0]).toMatchObject({ arrived: false, waitingForPair: false });
  });

  it('does not wait for a completed counterpart outside the completion filter', async () => {
    const result = await readFirst([{ ...other, isCompleted: true }], { completionFilter: 'incomplete' });
    expect(result.items[0]).toMatchObject({ waitingForPair: false });
    expect(result.nextCursor).toBeNull();
  });

  it('does not wait when the counterpart arrives', async () => {
    mocks.unarrived.delete(other.itemId);
    expect((await readFirst([other])).items[0]).toMatchObject({ waitingForPair: false });
  });

  it.each([true, false])('uses the counterpart pieces with includePieces=%s', async (includePieces) => {
    const pieces = [piece('piece:0'), piece('piece:1')];
    mocks.unarrived.add(pieces[0].itemId).add(pieces[1].itemId);
    const read = () => includePieces ? readFirst(pieces) : readFirst([other], { pairPieces: pieces });
    expect((await read()).items[0]).toMatchObject({ waitingForPair: true });
    mocks.unarrived.delete(pieces[1].itemId);
    expect((await read()).items[0]).toMatchObject({ waitingForPair: false });
  });

  it('keeps waiting for an outsourced counterpart', async () => {
    mocks.unarrived.delete(other.itemId);
    mocks.outsourced.set(other.itemId, 'pending');
    expect((await readFirst([other])).items[0]).toMatchObject({ arrived: true, waitingForPair: true });
  });
});

it('ranks pair suggestions by the number of distinct matching serial numbers', async () => {
  const results = [
    { partName: 'テーブル', seibanCount: 41 },
    { partName: 'Y軸テーブル', seibanCount: 12 },
    { partName: secondPartName, seibanCount: 190 }
  ];
  mocks.raw.mockResolvedValue(results);
  expect((await getPlanningPairSuggestions(firstPartName)).suggestions.map(({ partName }) => partName))
    .toEqual([secondPartName, 'テーブル', 'Y軸テーブル']);
  const [query] = mocks.raw.mock.calls[0];
  expect(query.sql).toContain('JOIN selected USING (fseiban, process_order)');
  expect(query.sql).toContain('COUNT(DISTINCT other.fseiban)');
  expect(query.values).toEqual(expect.arrayContaining([firstPartName, '305', '581', '589']));
});
