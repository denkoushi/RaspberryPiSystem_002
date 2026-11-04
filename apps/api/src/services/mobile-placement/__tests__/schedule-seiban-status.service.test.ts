import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), query: vi.fn(), machineNames: vi.fn() }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: mocks.machineNames }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleDScheduleMinutes: { findMany: mocks.findMany }, $queryRaw: mocks.query } }));
import { getScheduleSeiban, listScheduleSeibans } from '../schedule-seiban-status.service.js';

const schedule = (fseiban: string, extra = {}) => ({ fseiban, isAlias: false, aliasOf: null, partsCompleteDate: new Date('2026-11-05'),
  surfaceSendOutDates: [{ date: '2026-11-04' }, { date: '2026-11-02' }], outsourceMarks: ['X', 'Y'], memo: 'memo', ...extra });
const part = (productNo: string, extra = {}) => ({ productNo, fseiban: 'BA1', fhincd: 'MD1-001', fhinmei: '部品', completed: false, ...extra });
const placement = (productNo: string, shelfCodeRaw: string, extra = {}) => ({ manufacturingOrderBarcodeRaw: productNo, shelfCodeRaw, slipKind: 'manufacturing_order', updatedAt: new Date(), scheduleSnapshot: null, ...extra });
function batch(parts: unknown[], records: unknown[] = [], branches: unknown[] = [], haizen: unknown[] = [], shelves: unknown[] = []) {
  mocks.query.mockResolvedValueOnce(parts).mockResolvedValueOnce(records).mockResolvedValueOnce(branches).mockResolvedValueOnce(haizen).mockResolvedValueOnce(shelves);
}
beforeEach(() => { vi.resetAllMocks(); mocks.findMany.mockResolvedValue([schedule('BA1')]); mocks.query.mockResolvedValue([]); mocks.machineNames.mockResolvedValue({ machineNames: { BA1: '機種', BA3: '機種名未登録' } }); });

describe('schedule seiban status', () => {
  it('includes aliases, completion precedence, verified without shelf, purchases and Zero2W in fixed batches', async () => {
    mocks.findMany.mockResolvedValue([schedule('BA1'), schedule('BA2', { isAlias: true, aliasOf: 'BA1' })]);
    batch([part('1', { completed: true }), part('2'), part('3', { fseiban: 'BA2' }), part('4', { fhincd: 'MD9(A)-001' }), part('5')],
      [{ transferOrderBarcodeRaw: '　1 ' }, { transferOrderBarcodeRaw: ' 2　' }],
      [placement('1', 'old'), placement('purchase:9', 'purchase-shelf', { slipKind: 'purchase_order', scheduleSnapshot: { FSEIBAN: 'BA1', FHINCD: 'MD9-002' } })],
      [placement('　3 ', 'zero-shelf')], [{ shelfCodeRaw: 'zero-shelf', displayLabel: '棚名' }]);
    const result = await getScheduleSeiban('BA1');
    expect(result).toMatchObject({ fseiban: 'BA1', aliasFseibans: ['BA2'], partsCompleteDate: '2026-11-05', sendOutDate: '2026-11-02', machineName: '機種', counts: { done: 1, verified: 1, shelf: 2, pending: 1 } });
    expect(result?.parts.map(row => row.state)).toEqual(['done', 'verified', 'shelf', 'shelf', 'pending']);
    expect(result?.parts[2]).toMatchObject({ shelfLabel: '棚名', shelfCodeRaw: 'zero-shelf' });
    expect(result?.parts[3]).toMatchObject({ shelfLabel: 'purchase-shelf' });
    expect(mocks.query).toHaveBeenCalledTimes(5);
    const [strings, ...values] = mocks.query.mock.calls[0];
    const sql = Prisma.sql(strings, ...values);
    expect(sql.text).toContain('bool_and((COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)))');
    expect(sql.text).toContain("GROUP BY r.\"rowData\"->>'ProductNo'");
    expect(sql.values).toContainEqual(['BA1', 'BA2']);
    expect(sql.text).toContain('LIMIT 1');
    expect(mocks.machineNames).toHaveBeenCalledWith(['BA1']);
  });
  it('excludes all completed and zero-part seibans, with null dates ordered last by the database', async () => {
    mocks.findMany.mockResolvedValue([schedule('BA1'), schedule('BA2'), schedule('BA3', { partsCompleteDate: null }), schedule('BA4')]);
    batch([part('1', { completed: true }), part('2', { fseiban: 'BA2' }), part('3', { fseiban: 'BA3' })]);
    const listed = (await listScheduleSeibans()).seibans;
    expect(listed.map(row => row.fseiban)).toEqual(['BA2', 'BA3']);
    expect(listed[1]?.machineName).toBeNull();
    expect(mocks.findMany.mock.calls[0][0].orderBy[0]).toEqual({ partsCompleteDate: { sort: 'asc', nulls: 'last' } });
  });
  it('never discovers a seiban outside Excel and returns null for unknown detail', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await listScheduleSeibans()).toEqual({ seibans: [], truncated: false });
    expect(await getScheduleSeiban('unknown')).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('limits the active list to 200 and reports truncation, without exposing parts', async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, i) => schedule(`BA${i}`)));
    batch(Array.from({ length: 201 }, (_, i) => part(`${i}`, { fseiban: `BA${i}` })));
    const result = await listScheduleSeibans();
    expect(result.seibans).toHaveLength(200); expect(result.truncated).toBe(true);
    expect(result.seibans[0]).not.toHaveProperty('parts');
  });
  it('chooses the latest shelf across manufacturing and purchase placements', async () => {
    batch([part('1')], [], [
      placement('1', 'old', { updatedAt: new Date('2026-11-01') }),
      placement('purchase:9', 'new', { updatedAt: new Date('2026-11-02'), slipKind: 'purchase_order', scheduleSnapshot: { FSEIBAN: 'BA1', FHINCD: 'MD1-002' } })
    ]);
    expect((await getScheduleSeiban('BA1'))?.parts[0].shelfCodeRaw).toBe('new');
  });
  it('uses only purchases with the same seiban and normalized part code', async () => {
    batch([part('1')], [], [placement('purchase:9', 'wrong', { slipKind: 'purchase_order', scheduleSnapshot: { FSEIBAN: 'OTHER', FHINCD: 'MD1-002' } })]);
    expect((await getScheduleSeiban('BA1'))?.parts[0].state).toBe('pending');
  });
});
