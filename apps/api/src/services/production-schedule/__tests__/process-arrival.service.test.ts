import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), placements: vi.fn(), overrides: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.query, orderPlacementBranchState: { findMany: mocks.placements },
  productionScheduleGrindingPlanningBoardOverride: { findMany: mocks.overrides }
} }));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: async () => ({}),
  isProductionScheduleExcludedCuttingResourceCd: (cd: string) => ['10', 'MSZ'].includes(cd)
}));

import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';
import { buildProcessArrivalByRowId, enrichRowsWithProcessArrival, type ArrivalProcess } from '../process-arrival.service.js';

const row = (id: string, processOrder: string, productNo = '100') => ({
  id, sourceRowId: id,
  rowData: { FSEIBAN: 'ORDER', FHINCD: 'PART', ProductNo: productNo, FKOJUN: processOrder, FSIGENCD: '305' }
});
const process = (processOrder: string, resourceCd: string, isCompleted = false): ArrivalProcess => ({
  fseiban: 'ORDER', fhincd: 'PART', productNo: '100', processOrder, resourceCd, isCompleted
});
const excluded = (cd: string) => ['10', 'MSZ'].includes(cd);

describe('process arrival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.placements.mockResolvedValue([]);
    mocks.overrides.mockResolvedValue([]);
  });

  it('always arrives at the first process, without checking material purchase status', () => {
    expect(buildProcessArrivalByRowId([row('a', '10')], [process('10', '305')], excluded).get('a')).toBe(true);
  });

  it.each([
    [[process('10', '10'), process('20', 'MSZ')], '30', true],
    [[process('10', '305', true)], '30', false],
    [[process('10', '305')], '', true],
    [[process('30', '305')], '30', true]
  ] as const)('identifies first processes independently of completion (%j, %s)', (processes, ownOrder, isFirstProcess) => {
    const rows = [row('target', ownOrder)];
    const legacy = buildProcessArrivalByRowId(rows, processes, excluded);
    const detailed = buildProcessArrivalByRowId(rows, processes, excluded, undefined, { includeFirstProcess: true });
    expect(detailed.get('target')).toEqual({ arrived: legacy.get('target'), isFirstProcess });
    expect(typeof legacy.get('target')).toBe('boolean');
  });

  it('treats null FKOJUN as first and keeps unassigned ProductNos isolated', () => {
    const noOrder = { ...row('no-order', ''), rowData: { ...row('no-order', '').rowData, FKOJUN: null } };
    expect(buildProcessArrivalByRowId([noOrder], [process('10', '305')], excluded, undefined, { includeFirstProcess: true }).get('no-order'))
      .toEqual({ arrived: true, isFirstProcess: true });
    const unassigned = { ...row('unassigned', '30', '200'), rowData: { ...row('unassigned', '30', '200').rowData, FSEIBAN: '********' } };
    expect(buildProcessArrivalByRowId([unassigned], [{ ...process('10', '305', true), fseiban: '********' }], excluded, undefined,
      { includeFirstProcess: true }).get('unassigned')).toEqual({ arrived: true, isFirstProcess: true });
    expect([...buildProcessArrivalByRowId([noOrder], [], excluded, undefined, { includeFirstProcess: false }).values()]).toEqual([true]);
  });

  it('includes first-process metadata only when explicitly requested', async () => {
    mocks.query.mockResolvedValue([process('10', '305', true)]);
    const rows = [row('target', '30'), row('no-order', '')];
    const legacy = await enrichRowsWithProcessArrival(rows, { locationKey: 'site' });
    expect(legacy.every((item) => !('isFirstProcess' in item))).toBe(true);
    const detailed = await enrichRowsWithProcessArrival(rows, { locationKey: 'site', includeFirstProcess: true });
    expect(detailed.map((item) => item.isFirstProcess)).toEqual([false, true]);
    expect(detailed.map((item) => item.arrived)).toEqual(legacy.map((item) => item.arrived));
  });

  it('waits for every earlier process across grinding → cutting → grinding, with strict FKOJUN comparison', () => {
    const rows = [row('a', '10'), row('cut', '20'), row('b', '30'), row('same-order', '20')];
    const processes = [process('10', '305', true), process('20', '001'), process('30', '305')];
    expect([...buildProcessArrivalByRowId(rows, processes, excluded).values()]).toEqual([true, true, false, true]);
    processes[1]!.isCompleted = true;
    expect(buildProcessArrivalByRowId(rows, processes, excluded).get('b')).toBe(true);
    processes[0]!.isCompleted = false;
    expect(buildProcessArrivalByRowId(rows, processes, excluded).get('b')).toBe(false);
  });

  it('ignores excluded resources 10 and MSZ', () => {
    expect(buildProcessArrivalByRowId([row('b', '30')], [process('10', '10'), process('20', 'MSZ')], excluded).get('b')).toBe(true);
  });

  it('uses fseiban + fhincd for ordinary parts even across ProductNo, and isolates other parts', () => {
    const otherPart = { ...process('1', '305'), fhincd: 'OTHER' };
    expect(buildProcessArrivalByRowId([row('b', '30', '200')], [process('10', '305'), otherPart], excluded).get('b')).toBe(false);
    expect(buildProcessArrivalByRowId([row('a', '10')], [otherPart], excluded).get('a')).toBe(true);
  });

  it('keeps unassigned parts separate by ProductNo', () => {
    const source = row('b', '30', '200'); source.rowData.FSEIBAN = '********';
    expect(buildProcessArrivalByRowId([source], [{ ...process('10', '305'), fseiban: '********' }], excluded).get('b')).toBe(true);
  });

  it('keeps the parent waiting until its earlier process completes or shelf placement exists', async () => {
    mocks.query.mockResolvedValue([process('10', '001')]);
    const rows = [row('grinding-b', '30')];
    expect((await enrichRowsWithProcessArrival(rows, { locationKey: 'site' })).map((r) => r.arrived)).toEqual([false]);
    mocks.placements.mockResolvedValue([{ manufacturingOrderBarcodeRaw: '100' }]);
    expect((await enrichRowsWithProcessArrival(rows, { locationKey: 'site' })).map((r) => r.arrived)).toEqual([true]);
  });

  it('uses the chip effective completion SQL, so external completion counts', async () => {
    mocks.query.mockResolvedValue([process('10', '001', true)]);
    const result = await enrichRowsWithProcessArrival([row('b', '30')], { siteKey: 'site', locationKey: 'terminal' });
    expect(result[0]!.arrived).toBe(true);
    const sql = mocks.query.mock.calls[0]![0].strings.join('?');
    expect(sql).toContain('COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)');
    expect(sql).toContain('LEFT JOIN "ProductionScheduleExternalCompletion"');
  });

  it('queries 700 distinct part keys once and retains every arrival result', async () => {
    const rows = Array.from({ length: 700 }, (_, index) => {
      const item = row(`row-${index}`, '30');
      item.rowData.FHINCD = `PART-${index}`;
      return item;
    });
    mocks.query.mockResolvedValue(rows.map((item) => ({
      ...process('10', '001'), fhincd: item.rowData.FHINCD
    })));
    const result = await enrichRowsWithProcessArrival(rows, { locationKey: 'site' });
    expect(result).toHaveLength(700);
    expect(result.every((item) => item.arrived === false)).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const sql = mocks.query.mock.calls[0]![0];
    expect(sql.strings.join('?')).toContain('FROM unnest(?::text[], ?::text[], ?::text[])');
    expect(sql.strings.join('?')).toContain('INNER JOIN "CsvDashboardRow"');
    expect(sql.strings.join('?')).toContain('ON "csvDashboardId" = ?');
    expect(sql.strings.join('?')).toContain(`BTRIM("rowData"->>'FSEIBAN') = k.fseiban`);
    expect(sql.strings.join('?')).toContain(`BTRIM("rowData"->>'FHINCD') = k.fhincd`);
    expect(sql.strings.join('?')).toContain(`k.product_no IS NULL OR BTRIM("rowData"->>'ProductNo') = k.product_no`);
    expect(sql.values.slice(0, 3)).toEqual([
      rows.map((item) => item.rowData.FSEIBAN), rows.map((item) => item.rowData.FHINCD), Array(700).fill(null)
    ]);
    expect(sql.values.filter((value: unknown) => typeof value === 'string' && value.startsWith('row-'))).toHaveLength(700);
  });

  it('passes NULL for ordinary ProductNos and preserves empty unassigned ProductNos', async () => {
    mocks.query.mockResolvedValue([]);
    const unassigned = row('unassigned', '30', '');
    unassigned.rowData.FSEIBAN = '********';
    await enrichRowsWithProcessArrival([row('normal', '30'), unassigned], { locationKey: 'site' });
    expect(mocks.query.mock.calls[0]![0].values[2]).toEqual([null, '']);
  });

  it('skips the process query when no valid part keys remain', async () => {
    const invalid = row('invalid', '30');
    invalid.rowData.FSEIBAN = ' ';
    expect(await enrichRowsWithProcessArrival([invalid], { locationKey: 'site' })).toEqual([{ ...invalid, arrived: true }]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('attaches parent special due and ignores a leftover old override', async () => {
    mocks.query.mockResolvedValue([process('10', '001')]);
    const parent = row('parent', '30');
    const itemKey = buildGrindingPlanningBoardRowItemId(parent.rowData);
    mocks.overrides.mockResolvedValue([
      { itemKey: 'split:one', specialDueKind: 'overnight', specialDueExpiresAt: new Date('2026-11-06T00:00:00Z') }
    ]);
    const scope = { siteKey: 'site', locationKey: 'terminal', includeSpecialDue: true };
    expect((await enrichRowsWithProcessArrival([parent], scope))[0]).toMatchObject({ arrived: false, specialDue: null });
    expect(mocks.overrides).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siteKey: 'site', itemKey: { in: [itemKey] } }) }));
    mocks.overrides.mockResolvedValue([
      { itemKey, specialDueKind: 'overnight', specialDueExpiresAt: new Date('2026-11-06T00:00:00Z') }
    ]);
    expect((await enrichRowsWithProcessArrival([parent], scope))[0]).toMatchObject({
      arrived: false, specialDue: { kind: 'overnight', expiresAt: '2026-11-06T00:00:00.000Z' }
    });
  });
});
