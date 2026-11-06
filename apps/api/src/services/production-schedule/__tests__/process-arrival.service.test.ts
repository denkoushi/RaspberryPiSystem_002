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

import { buildProcessArrivalByRowId, enrichRowsWithProcessArrival, type ArrivalProcess } from '../process-arrival.service.js';

const row = (id: string, processOrder: string, productNo = '100') => ({
  id, sourceRowId: id.startsWith('split:') ? 'grinding-b' : id,
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

  it('treats shelf placement as arrived and splits inherit the source process result', async () => {
    mocks.query.mockResolvedValue([process('10', '001')]);
    const rows = [row('grinding-b', '30'), row('split:one', '30'), row('split:two', '30')];
    expect((await enrichRowsWithProcessArrival(rows, { locationKey: 'site' })).map((r) => r.arrived)).toEqual([false, false, false]);
    mocks.placements.mockResolvedValue([{ manufacturingOrderBarcodeRaw: '100' }]);
    expect((await enrichRowsWithProcessArrival(rows, { locationKey: 'site' })).map((r) => r.arrived)).toEqual([true, true, true]);
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
    expect(sql.strings.join('?')).toContain('SELECT 1 FROM unnest(?::text[], ?::text[], ?::text[])');
    expect(sql.values.slice(1, 4)).toEqual([
      rows.map((item) => item.rowData.FSEIBAN), rows.map((item) => item.rowData.FHINCD), Array(700).fill(null)
    ]);
    expect(sql.values.filter((value: unknown) => typeof value === 'string' && value.startsWith('row-'))).toHaveLength(700);
  });

  it('passes NULL for ordinary ProductNos and preserves empty unassigned ProductNos', async () => {
    mocks.query.mockResolvedValue([]);
    const unassigned = row('unassigned', '30', '');
    unassigned.rowData.FSEIBAN = '********';
    await enrichRowsWithProcessArrival([row('normal', '30'), unassigned], { locationKey: 'site' });
    expect(mocks.query.mock.calls[0]![0].values[3]).toEqual([null, '']);
  });

  it('skips the process query when no valid part keys remain', async () => {
    const invalid = row('invalid', '30');
    invalid.rowData.FSEIBAN = ' ';
    expect(await enrichRowsWithProcessArrival([invalid], { locationKey: 'site' })).toEqual([{ ...invalid, arrived: true }]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('attaches leader special due from the same row/split override keys as the planning board', async () => {
    mocks.query.mockResolvedValue([process('10', '001')]);
    mocks.overrides.mockResolvedValue([{ itemKey: 'split:one', specialDueKind: 'overnight', specialDueExpiresAt: new Date('2026-11-06T00:00:00Z') }]);
    const result = await enrichRowsWithProcessArrival([row('split:one', '30')], { siteKey: 'site', locationKey: 'terminal', includeSpecialDue: true });
    expect(result[0]).toMatchObject({ arrived: false, specialDue: { kind: 'overnight', expiresAt: '2026-11-06T00:00:00.000Z' } });
    expect(mocks.overrides).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siteKey: 'site', itemKey: { in: ['split:one'] } }) }));
  });
});
