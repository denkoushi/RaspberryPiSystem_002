import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({
  raw: vi.fn(),
  pairs: vi.fn(),
  findPair: vi.fn(),
  createPair: vi.fn(),
  unarrived: new Set<string>(),
  outsourced: new Map<string, 'pending'>()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.raw,
  $transaction: (run: (tx: unknown) => unknown) => run({
    $queryRaw: mocks.raw,
    productionScheduleGrindingPlanningBoardPair: { findFirst: mocks.findPair, create: mocks.createPair }
  }),
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
import { createPlanningPair, getPlanningPairCandidates, getPlanningPairStatus, getPlanningPairSuggestions } from './pairs.js';
import { getGrindingPlanningBoard } from './read.js';

const firstPartName = '足（１）';
const secondPartName = '足（２）';
const firstPartCode = 'MD004291472';
const secondPartCode = 'MD004291481';
const pair = { firstPartCode, firstPartName, secondPartCode, secondPartName };
const item = (itemId: string, fhinmei: string, fhincd: string, overrides: Partial<GrindingPlanningBoardItem> = {}) => ({
  itemId, sourceRowId: itemId, itemRevision: itemId, kind: 'row', version: 0,
  fseiban: 'lot', processOrder: '210', fhinmei, fhincd, productNo: itemId,
  originalResourceCd: '305', effectiveResourceCd: '305', isCompleted: false, ...overrides
} as GrindingPlanningBoardItem);
const own = item('left', firstPartName, firstPartCode);
const other = item('right', secondPartName, secondPartCode, { originalResourceCd: '581' });
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
  mocks.pairs.mockReset().mockResolvedValue([{ id: 'pair', ...pair }]);
  mocks.findPair.mockReset().mockResolvedValue(null);
  mocks.createPair.mockReset();
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
    ['a different FHINCD with the same name', [{ ...other, fhincd: 'MD004240000' }]]
  ])('does not wait for a counterpart %s', async (_label, counterparts) => {
    expect((await readFirst(counterparts)).items[0]).toMatchObject({ arrived: true, waitingForPair: false });
  });

  it('matches the same FHINCD even when the name has changed', async () => {
    expect((await readFirst([{ ...other, fhinmei: '足(2)' }])).items[0])
      .toMatchObject({ arrived: true, waitingForPair: true });
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
    { partName: 'テーブル', partCode: 'table', seibanCount: 41 },
    { partName: secondPartName, partCode: 'MD004240000', seibanCount: 12 },
    { partName: secondPartName, partCode: secondPartCode, seibanCount: 190 }
  ];
  mocks.raw.mockResolvedValue(results);
  expect((await getPlanningPairSuggestions(firstPartCode)).suggestions.map(({ partCode }) => partCode))
    .toEqual([secondPartCode, 'table', 'MD004240000']);
  const [query] = mocks.raw.mock.calls[0];
  expect(query.sql).toContain('JOIN selected USING (fseiban, process_order)');
  expect(query.sql).toContain('COUNT(DISTINCT other.fseiban)');
  expect(query.sql).toContain('GROUP BY other.part_code');
  expect(query.values).toEqual(expect.arrayContaining([firstPartCode, '305', '581', '589']));
});

it('puts the closest part name first even when another part shares more serials', async () => {
  mocks.raw.mockResolvedValue([
    { partName: 'カバー', partCode: 'cover', seibanCount: 146, selectedName: firstPartName },
    { partName: secondPartName, partCode: secondPartCode, seibanCount: 145, selectedName: firstPartName }
  ]);
  expect((await getPlanningPairSuggestions(firstPartCode)).suggestions).toEqual([
    { partName: secondPartName, partCode: secondPartCode, seibanCount: 145 },
    { partName: 'カバー', partCode: 'cover', seibanCount: 146 }
  ]);
});

it('lists distinct grinding part names and codes', async () => {
  const parts = [
    { partCode: firstPartCode, partName: firstPartName },
    { partCode: 'MD004239990', partName: firstPartName }
  ];
  mocks.raw.mockResolvedValue(parts);
  expect(await getPlanningPairCandidates()).toEqual({ parts });
  const [query] = mocks.raw.mock.calls[0];
  expect(query.sql).toContain('SELECT DISTINCT part_name AS "partName", part_code AS "partCode"');
  expect(query.values).toEqual(expect.arrayContaining(['305', '581', '589']));
});

it('lists the target grinding parts with distinct serial-number counts per name and code', async () => {
  const parts = [
    { partCode: firstPartCode, partName: firstPartName, seibanCount: 146 },
    { partCode: 'MD004239990', partName: firstPartName, seibanCount: 29 }
  ];
  mocks.raw.mockResolvedValue(parts);
  expect(await getPlanningPairStatus()).toEqual({ parts });
  const [query] = mocks.raw.mock.calls[0];
  expect(query.sql).toContain("COUNT(DISTINCT fseiban) FILTER (WHERE fseiban NOT IN ('', '********'))");
  expect(query.sql).toContain('GROUP BY part_name, part_code');
  expect(query.values).toEqual(expect.arrayContaining(['305', '581', '589', '%足%', '%脚%', '%スタンド%']));
});

it('registers different codes with the same name and checks both sides for membership', async () => {
  const sameNames = { ...pair, secondPartName: firstPartName };
  mocks.raw.mockResolvedValue([
    { partCode: firstPartCode, partName: firstPartName },
    { partCode: secondPartCode, partName: firstPartName }
  ]);
  const saved = { id: 'pair', ...sameNames };
  mocks.createPair.mockResolvedValue(saved);
  expect(await createPlanningPair('site', sameNames)).toEqual(saved);
  expect(mocks.findPair).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    siteKey: 'site', OR: [
      { firstPartCode: { in: [firstPartCode, secondPartCode] } },
      { secondPartCode: { in: [firstPartCode, secondPartCode] } }
    ]
  }) }));

  mocks.findPair.mockResolvedValue(saved);
  await expect(createPlanningPair('site', {
    ...pair, firstPartCode: secondPartCode, secondPartCode: firstPartCode
  })).resolves.toEqual(saved);
  await expect(createPlanningPair('site', { ...pair, firstPartCode: secondPartCode, secondPartCode: 'other' }))
    .rejects.toMatchObject({ code: 'PLANNING_PAIR_PART_IN_USE' });
  await expect(createPlanningPair('site', { ...pair, secondPartCode: firstPartCode }))
    .rejects.toMatchObject({ code: 'SAME_PLANNING_PAIR_PART' });
  expect(mocks.createPair).toHaveBeenCalledTimes(1);
});
