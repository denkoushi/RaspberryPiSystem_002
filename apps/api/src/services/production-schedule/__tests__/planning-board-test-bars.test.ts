import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ProductionScheduleGrindingPlanningBoardTestBar } from '@prisma/client';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';
import { sessakuPieceKeyFromRow } from '../sessaku-pieces/piece-key.js';

const mocks = vi.hoisted(() => ({ categoryResource: vi.fn(() => true), master: vi.fn(), transaction: vi.fn(), winnerRows: vi.fn(), executeRaw: vi.fn(), queryRaw: vi.fn(), current: vi.fn(), save: vi.fn(), project: vi.fn(),
  details: vi.fn(), completionFlags: vi.fn(), overrides: vi.fn(), overrideRecords: vi.fn(), pieceSets: vi.fn(), pieces: vi.fn(),
  progressRows: vi.fn(),
  table: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  state: { findUniqueOrThrow: vi.fn(), update: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.queryRaw, $transaction: mocks.transaction, productionScheduleGrindingPlanningBoardState: mocks.state,
  productionScheduleSessakuPieceSet: { findMany: async () => [] }
} }));
vi.mock('../grinding-planning-board/state.js', () => ({
  ensurePlanningBoardState: vi.fn(), lockState: async () => ({ id: 'board', seibanOrder: ['lot'] }),
  assertBoardRevision: vi.fn(), stateOrder: () => ['lot'], boardRevision: () => 'r2'
}));
vi.mock('../grinding-planning-board/source.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/source.js')>(),
  readMasterResourceCds: mocks.master, readWinnerRowsByFseibans: mocks.winnerRows, readOverrides: mocks.overrides,
  readWinnerProgressRows: mocks.progressRows, readRowDetails: mocks.details, readRowCompletionFlags: mocks.completionFlags, readRanks: async () => ({ rows: new Map() })
}));
vi.mock('../grinding-planning-board/write.js', () => ({
  resolveCurrentProjectionInTransaction: mocks.current, writeOverrideIfChanged: mocks.save, projectCurrentItems: mocks.project
}));
vi.mock('../grinding-planning-board/shared.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/shared.js')>(),
  assertItemRevision: vi.fn(), isCategoryResource: mocks.categoryResource, STRING_TRIM_CHARACTERS: ' '
}));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: async () => ({ cuttingExcludedResourceCds: [] }), normalizeProductionScheduleResourceCd: (cd: string) => cd
}));
vi.mock('../sessaku-pieces/piece-key.js', async (original) => ({
  ...await original<typeof import('../sessaku-pieces/piece-key.js')>(),
  acquireSessakuPieceLogicalLocks: vi.fn()
}));
vi.mock('../grinding-planning-board-resource-minutes.service.js', () => ({
  getGrindingPlanningBoardResourceMinutes: async () => ({ values: [] })
}));
vi.mock('../grinding-planning-board/schedule-source.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/schedule-source.js')>(), readScheduleSourceExcludedFseibans: async () => []
}));
import { getPlanningTestBarPartCandidates, createPlanningTestBar, mutatePlanningTestBar, mixedPlanningLane, projectPlanningTestBar, reorderPlanningTestBarLane } from '../grinding-planning-board/test-bars.js';

const band = { kind: 'today' as const, expiresAt: '2026-11-12T00:00:00.000Z' };
const normal = (itemId: string, alternateRank: number, specialDue: GrindingPlanningBoardItem['specialDue'] = null) => ({
  kind: 'row', itemId, itemRevision: itemId, sourceRowId: `row-${itemId}`, fseiban: 'lot', productNo: '', fhincd: '', processOrder: '1', effectiveResourceCd: '761', originalResourceCd: '761',
  isCompleted: false, alternateRank, specialDue
} as GrindingPlanningBoardItem);
let items: GrindingPlanningBoardItem[];
let rows: ProductionScheduleGrindingPlanningBoardTestBar[];
let overrides: Map<string, { alternateRank: number }>;
const ref = (itemId: string) => ({ itemId, itemRevision: itemId });
const lane = () => mixedPlanningLane(items.map((item) => ({ ...item, alternateRank: overrides.get(item.itemId)?.alternateRank ?? item.alternateRank })), rows.map(projectPlanningTestBar), ['lot'], '761');
const request = { siteKey: 'site', sourceRevision: 'r1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.categoryResource.mockReturnValue(true);
  mocks.master.mockResolvedValue(new Set(['761']));
  mocks.winnerRows.mockResolvedValue([]);
  mocks.overrides.mockResolvedValue(new Map());
  mocks.pieceSets.mockResolvedValue([]);
  mocks.pieces.mockResolvedValue([]);
  mocks.overrideRecords.mockResolvedValue([]);
  mocks.progressRows.mockResolvedValue([]);
  mocks.queryRaw.mockImplementation(async (_sql, _dashboardId?: string, ids?: string[]) => (ids ?? []).map((id) => ({ id })));
  items = [normal('a1', 1, band), normal('a2', 2, band), normal('n1', 1), normal('n2', 2), normal('n3', 3)];
  rows = []; overrides = new Map();
  mocks.state.findUniqueOrThrow.mockResolvedValue({}); mocks.state.update.mockResolvedValue({});
  mocks.table.findMany.mockImplementation(async () => rows);
  mocks.table.findFirst.mockImplementation(async ({ where }) => { const row = rows.find((row) => row.id === where.id); return row ? { ...row } : null; });
  mocks.table.create.mockImplementation(async ({ data }) => { const row = { ...data, id: 'uuid', version: 1, completedAt: null, deletedAt: null }; rows.push(row); return row; });
  mocks.table.update.mockImplementation(async ({ where, data }) => { const row = rows.find((row) => row.id === where.id)!; Object.assign(row, { ...data, version: row.version + 1 }); return row; });
  mocks.table.findUniqueOrThrow.mockImplementation(async () => rows[0]);
  mocks.transaction.mockImplementation(async (run) => run({ $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw,
    productionScheduleGrindingPlanningBoardTestBar: mocks.table, productionScheduleGrindingPlanningBoardState: mocks.state,
    productionScheduleGrindingPlanningBoardOverride: { findMany: mocks.overrideRecords },
    productionScheduleSessakuPieceSet: { findMany: mocks.pieceSets }, productionScheduleSessakuPiece: { findMany: mocks.pieces } }));
  mocks.current.mockImplementation(async () => ({ state: { id: 'board' }, byItemId: new Map(items.map((item) => [item.itemId, { ...item, alternateRank: overrides.get(item.itemId)?.alternateRank ?? item.alternateRank }])), overrides, masterResourceCds: new Set(['761']) }));
  mocks.save.mockImplementation(async (_tx, _site, _id, _previous, data) => data);
  mocks.project.mockImplementation(() => new Map(items.map((item) => [item.itemId, item])));
});
const ids = (lane: GrindingPlanningBoardBar[]) => lane.map((item) => item.itemId);
const expectBands = () => {
  expect(ids(lane()).slice(0, 2)).toEqual(['a1', 'a2']);
  expect(lane().map((item) => item.alternateRank)).toEqual([1, 2, 1, 2, 3, 4]);
};

describe('test bar special due bands', () => {
  it.each([undefined, 'a1', 'n1'])('creates within the unbanded lane after %s and preserves per-band ranks', async (after) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30, ...(after ? { afterItem: ref(after) } : {}) });
    expectBands();
    expect(ids(lane())).toEqual(['a1', 'a2', ...(after === 'n1' ? ['n1', 'test:uuid'] : ['test:uuid', 'n1']), 'n2', 'n3']);
  });
  it.each(['single', 'bulk'] as const)('reorders within the unbanded lane using %s and keeps the priority band first', async (mode) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
    const test = projectPlanningTestBar(rows[0]);
    await reorderPlanningTestBarLane(mode === 'single'
      ? { ...request, ...ref(test.itemId), itemRevision: test.itemRevision, targetItemId: 'n2', targetItemRevision: 'n2', placement: 'after' }
      : { ...request, resourceCd: '761', items: [ref('a1'), ref('a2'), ref('n1'), ref('n2'), { itemId: test.itemId, itemRevision: test.itemRevision }, ref('n3')] });
    expectBands();
    expect(ids(lane())).toEqual(['a1', 'a2', 'n1', 'n2', 'test:uuid', 'n3']);
  });
  it.each(['test-to-band', 'band-to-test', 'bulk'] as const)('rejects crossing the priority band (%s)', async (mode) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
    const test = projectPlanningTestBar(rows[0]); mocks.save.mockClear(); mocks.table.update.mockClear();
    const testRef = { itemId: test.itemId, itemRevision: test.itemRevision };
    const source = mode === 'band-to-test' ? ref('a1') : testRef;
    const target = mode === 'band-to-test' ? testRef : ref('a1');
    await expect(reorderPlanningTestBarLane(mode === 'bulk'
      ? { ...request, resourceCd: '761', items: [ref('a1'), testRef, ref('a2'), ref('n1'), ref('n2'), ref('n3')] }
      : { ...request, ...source, targetItemId: target.itemId, targetItemRevision: target.itemRevision, placement: 'before' }))
      .rejects.toMatchObject({ code: 'SPECIAL_DUE_ORDER_BAND_MISMATCH' });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.table.update).not.toHaveBeenCalled();
  });
});

it('locks only the parent rows of the saved lane, however many rows the board has', async () => {
  // 10k+ board rows used to be advisory-locked one by one and exhausted the shared lock table.
  mocks.winnerRows.mockResolvedValue(Array.from({ length: 12000 }, (_, index) => ({ id: `board-${index}` })));
  items = [...items, normal('n1-piece', 4), { ...normal('other', 1), effectiveResourceCd: '762', originalResourceCd: '762' }];
  items[items.length - 2] = { ...items[items.length - 2]!, sourceRowId: 'row-n1' };
  await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
  const laneRows = ['row-a1', 'row-a2', 'row-n1', 'row-n2', 'row-n3'];
  expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  expect(mocks.executeRaw.mock.calls[0][1]).toHaveLength(laneRows.length);
  const [sql, , lockedIds] = mocks.queryRaw.mock.calls.at(-1)!;
  expect(sql.join('?')).toBe('SELECT "id" FROM "CsvDashboardRow" WHERE "csvDashboardId" = ? AND "id" = ANY(?::text[]) ORDER BY "id" FOR UPDATE');
  expect(lockedIds).toEqual(laneRows);
  expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.queryRaw.mock.invocationCallOrder.at(-1)!);
  expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]!);
});

const winner = (id: string, resource: string, part = id) => ({ id, rowData: { FSEIBAN: 'lot', FHINCD: part, FSIGENCD: resource, FKOJUN: id } });

it('reads row data, overrides and piece sets only for the lane candidates, even within the same lot', async () => {
  const source = await vi.importActual<typeof import('../grinding-planning-board/source.js')>('../grinding-planning-board/source.js');
  const inside = winner('inside', '761'), outside = winner('outside', '762');
  mocks.winnerRows.mockImplementationOnce(source.readWinnerRowsByFseibans);
  mocks.overrides.mockImplementationOnce(source.readOverrides);
  mocks.progressRows.mockImplementationOnce(source.readWinnerProgressRows);
  mocks.queryRaw.mockImplementation(async (sql, _dashboardId?: string, ids?: string[]) => {
    if (sql.text?.includes('jsonb_build_object')) {
      expect(sql.text).toContain('FROM unnest(');
      expect(sql.values).toContainEqual(['inside']);
      return [inside];
    }
    if (sql.text?.includes('FROM "ranked"')) {
      expect(sql.text).toMatch(/BTRIM\("r"."rowData"->>'FSIGENCD', \$\d+\) = ANY/);
      expect(sql.values).toContainEqual(['761']);
      return [inside, outside].filter((row) => sql.values.at(-1).includes(row.rowData.FSIGENCD));
    }
    return (ids ?? []).map((id) => ({ id }));
  });
  await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
  expect(mocks.overrideRecords).toHaveBeenCalledExactlyOnceWith({ where: expect.objectContaining({
    itemKey: { in: [buildGrindingPlanningBoardRowItemId(inside.rowData)] }
  }) });
  expect(mocks.pieceSets).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: expect.objectContaining({
    OR: [sessakuPieceKeyFromRow(inside.rowData)]
  }) }));
  expect(mocks.progressRows).toHaveBeenCalledExactlyOnceWith(expect.anything(), ['lot'], [sessakuPieceKeyFromRow(inside.rowData)]);
});

it('hydrates details only for lane parents, including rows, pieces and operation ranges moved into the lane', async () => {
  const { testBar } = await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
  const { resolveCurrentProjectionInTransaction, projectCurrentItems } = await vi.importActual<typeof import('../grinding-planning-board/write.js')>('../grinding-planning-board/write.js');
  mocks.current.mockImplementationOnce(resolveCurrentProjectionInTransaction);
  mocks.project.mockImplementationOnce(projectCurrentItems);
  const inside = winner('inside', '761');
  const inbound = winner('inbound', '762');
  const outbound = winner('outbound', '761', 'inside');
  const split = winner('split', '762');
  const piece = winner('piece', '763');
  const inboundIds = [buildGrindingPlanningBoardRowItemId(inbound.rowData), 'pieceops:p:2', 'piece:q'];
  mocks.queryRaw.mockResolvedValueOnce(inboundIds.map((itemKey) => ({ itemKey })));
  mocks.pieces.mockResolvedValue([{ id: 'p', pieceSet: sessakuPieceKeyFromRow(split.rowData) }, { id: 'q', pieceSet: sessakuPieceKeyFromRow(piece.rowData) }]);
  mocks.winnerRows.mockImplementation(async (_tx, _order, scope) => [inside, inbound, outbound, split, piece, winner('other', '763')]
    .filter((row) => scope.resourceCds.includes(row.rowData.FSIGENCD) || scope.inboundKeys.some((key: { fkojun: string }) => key.fkojun === row.id)));
  mocks.progressRows.mockResolvedValue([inside, inbound, outbound, split, piece]);
  mocks.overrides.mockResolvedValue(new Map([
    [buildGrindingPlanningBoardRowItemId(inbound.rowData), { overrideResourceCd: '761' }],
    [buildGrindingPlanningBoardRowItemId(outbound.rowData), { overrideResourceCd: '762' }],
    ['pieceops:p:2', { overrideResourceCd: '761' }], ['piece:q', { overrideResourceCd: '761' }]
  ]));
  mocks.pieceSets.mockResolvedValue([
    { ...sessakuPieceKeyFromRow(split.rowData), pieces: [{ id: 'p', position: 1, quantity: 1, opSplits: [{ fromOpNo: 2, sourceResourceCd: '762' }] }] },
    { ...sessakuPieceKeyFromRow(piece.rowData), pieces: [{ id: 'q', position: 1, quantity: 1 }] }
  ]);
  mocks.details.mockImplementation(async (_tx, rowIds: string[]) => new Map(rowIds.map((id) => [id, { orderSupplements: [], rowNotes: [] }])));
  mocks.completionFlags.mockResolvedValue(new Map([['outbound', true]]));

  const result = await reorderPlanningTestBarLane({ ...request, ...ref('pieceops:p:2'),
    targetItemId: testBar.itemId, targetItemRevision: testBar.itemRevision, placement: 'after' });
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith(expect.anything(), ['inside', 'inbound', 'split', 'piece']);
  expect(mocks.completionFlags).toHaveBeenCalledExactlyOnceWith(expect.anything(), ['outbound']);
  expect(new Set(result.items.map((item) => item.itemId))).toEqual(new Set([buildGrindingPlanningBoardRowItemId(inside.rowData), ...inboundIds]));
  expect(result.items.find((item) => item.sourceRowId === 'inside')?.progress).toMatchObject({ completed: 1, total: 2 });
});

it('rejects the save when a lane parent row has disappeared', async () => {
  mocks.queryRaw.mockImplementation(async (_sql, _dashboardId?: string, ids?: string[]) => (ids ?? []).slice(1).map((id) => ({ id })));
  await expect(createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_ITEM' });
  expect(mocks.save).not.toHaveBeenCalled();
});

it('takes no row locks when a test bar is deleted without rewriting a lane', async () => {
  await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
  mocks.executeRaw.mockClear(); mocks.queryRaw.mockClear();
  await mutatePlanningTestBar({ ...request, id: rows[0]!.id, expectedVersion: rows[0]!.version, action: 'delete' });
  expect(mocks.executeRaw).not.toHaveBeenCalled();
  expect(mocks.queryRaw.mock.calls.some(([sql]) => Array.isArray(sql) && sql.join('?').includes('FOR UPDATE'))).toBe(false);
});


describe('test bar restore predecessor', () => {
  it.each(['normal', 'head', 'test', 'deleted', 'completed', 'resource', 'band', 'omitted', 'incomplete'] as const)(
    'restores using %s while preserving the special due band', async (scenario) => {
      items = [normal('priority', 1, band), normal('A', 1), normal('B', 2)];
      await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30,
        ...(scenario === 'head' ? {} : { afterItem: ref('A') }) });
      const target = rows[0];
      if (scenario === 'test') {
        // A separate test bar is the predecessor of T.
        rows.push({ ...target, id: 'predecessor', sequence: 2, alternateRank: 1 });
        items = items.filter((item) => item.itemId !== 'A'); overrides.delete('A');
      }
      await mutatePlanningTestBar({ ...request, id: target.id, expectedVersion: target.version,
        action: scenario === 'incomplete' ? 'complete' : 'delete' });
      const anchor = scenario === 'test' ? 'test:predecessor' : 'A';
      if (scenario === 'deleted') items = items.filter((item) => item.itemId !== 'A');
      if (scenario === 'completed') items = items.map((item) => item.itemId === 'A' ? { ...item, isCompleted: true } : item);
      if (scenario === 'resource') items = items.map((item) => item.itemId === 'A' ? { ...item, effectiveResourceCd: '762' } : item);
      if (scenario === 'band') {
        items = items.map((item) => item.itemId === 'A' ? { ...item, specialDue: band } : item);
        overrides.set('A', { alternateRank: 2 });
      }
      // Insert X at the normal head after T has disappeared.
      const currentLane = lane();
      for (const item of currentLane.filter((item) => item.kind !== 'test' && !item.specialDue)) {
        overrides.set(item.itemId, { alternateRank: (item.alternateRank ?? 0) + 1 });
      }
      for (const row of rows.filter((row) => !row.deletedAt && !row.completedAt)) row.alternateRank++;
      items.push(normal('X', 1));
      await mutatePlanningTestBar({ ...request, id: target.id, expectedVersion: target.version,
        action: scenario === 'incomplete' ? 'incomplete' : 'restore',
        ...(scenario === 'omitted' ? {} : { restoreAfterItemId: scenario === 'head' || scenario === 'incomplete' ? null : anchor }) });
      const expected = scenario === 'normal' ? ['priority', 'X', 'A', 'test:uuid', 'B']
        : scenario === 'test' ? ['priority', 'X', 'test:predecessor', 'test:uuid', 'B']
        : scenario === 'head' ? ['priority', 'test:uuid', 'X', 'A', 'B']
        : scenario === 'band' ? ['priority', 'A', 'X', 'test:uuid', 'B']
        : scenario === 'omitted' || scenario === 'incomplete' ? ['priority', 'X', 'test:uuid', 'A', 'B']
        : ['priority', 'X', 'test:uuid', 'B'];
      expect(ids(lane())).toEqual(expected);
      expect(ids(lane())[0]).toBe('priority');
    }
  );
});


describe('test bar part names', () => {
  it.each([undefined, null, '', '   ', ' モータブラケット ', '名'.repeat(200)])('saves and projects normalized partName %s', async (partName) => {
    const result = await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30, partName });
    const normalized = partName?.trim() || null;
    expect(rows[0].partName).toBe(normalized);
    expect(result.testBar).toMatchObject({ partName: normalized, name: normalized || 'テスト1' });
  });
  it('rejects names longer than 200 characters before writing', async () => {
    await expect(createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30, partName: '名'.repeat(201) }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TEST_BAR_PART_NAME' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('queries all distinct nonempty names with indexed machine stock first in one query', async () => {
    const parts = [{ partName: 'B', machineStock: true }, { partName: 'A', machineStock: false }];
    mocks.queryRaw.mockResolvedValue(parts);
    expect(await getPlanningTestBarPartCandidates({ siteKey: 'site', resourceCd: '761' })).toEqual({ parts });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const sql = mocks.queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual([' ', '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', ' ', '761', ' ', '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', ' ']);
    expect(sql.sql.match(/SELECT DISTINCT BTRIM/g)).toHaveLength(2);
    expect(sql.sql).toContain(`"rowData"->>'FSEIBAN' = '********'`);
    expect(sql.sql).toContain(`BTRIM("rowData"->>'FSIGENCD', ?) = ?`);
    expect(sql.sql).toContain(`BTRIM("rowData"->>'FHINMEI', ?) <> ''`);
    const allNames = sql.sql.split('), parts AS (')[1].split('SELECT parts.')[0];
    expect(allNames).not.toMatch(/FSEIBAN|FSIGENCD/);
    expect(sql.sql).toContain('FROM parts LEFT JOIN machine_stock USING ("partName")');
    expect(sql.sql).toContain('(machine_stock."partName" IS NOT NULL) AS "machineStock"');
    expect(sql.sql).toContain('ORDER BY "machineStock" DESC, parts."partName"');
    expect(mocks.categoryResource).toHaveBeenCalledWith('761', 'all', { cuttingExcludedResourceCds: [] });
  });
  it('returns an empty candidate list when there are no nonempty names', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    expect(await getPlanningTestBarPartCandidates({ siteKey: 'site', resourceCd: '761' })).toEqual({ parts: [] });
  });
  it.each(['unknown', 'category'])('rejects an invalid resource (%s) without querying rows', async (reason) => {
    if (reason === 'category') mocks.categoryResource.mockReturnValue(false);
    await expect(getPlanningTestBarPartCandidates({ siteKey: 'site', resourceCd: reason === 'unknown' ? '999' : '761' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RESOURCE_CD' });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
