import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sessaku-pieces/piece-operation-definitions.js', () => ({ lockOperationDefinitionPieces: async () => [], reconcileOperationDefinitionPieces: vi.fn() }));

const mocks = vi.hoisted(() => ({
  sources: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  values: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  ops: { deleteMany: vi.fn(), createMany: vi.fn() }, transaction: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleGrindingPlanningBoardResourceMinutesSource: mocks.sources,
  productionScheduleGrindingPlanningBoardResourcePartMinutes: mocks.values,
  productionScheduleGrindingPlanningBoardResourcePartOpMinutes: mocks.ops, $transaction: mocks.transaction
} }));
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { getGrindingPlanningBoardResourceMinutes, updateGrindingPlanningBoardResourceMinutesSource,
  updateGrindingPlanningBoardResourcePartMinutes } from '../grinding-planning-board-resource-minutes.service.js';

const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: 'site-a', resourceCd: '305' };
const value = { resourceCd: '305', fhincd: 'part', perUnitMinutes: 0.5, setupMinutes: 30 };

describe('resource minutes storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sources.findMany.mockResolvedValue([]);
    mocks.values.findMany.mockResolvedValue([]);
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [] });
    mocks.transaction.mockImplementation((callback) => callback({
      productionScheduleGrindingPlanningBoardResourcePartMinutes: mocks.values,
      productionScheduleGrindingPlanningBoardResourcePartOpMinutes: mocks.ops
    }));
  });
  it('returns only settings scoped to the site and dashboard', async () => {
    mocks.sources.findMany.mockResolvedValue([{ resourceCd: '305' }]);
    mocks.values.findMany.mockResolvedValue([value]);
    expect(await getGrindingPlanningBoardResourceMinutes({ siteKey: 'site-a' }))
      .toEqual({ ownSourceResourceCds: ['305'], values: [value] });
    for (const table of [mocks.sources, mocks.values]) expect(table.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { csvDashboardId: key.csvDashboardId, siteKey: 'site-a' }
    }));
    await getGrindingPlanningBoardResourceMinutes({ siteKey: 'site-b' });
    expect(mocks.values.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { csvDashboardId: key.csvDashboardId, siteKey: 'site-b' } }));
  });
  it('upserts a trimmed source and deletes it on original without deleting values', async () => {
    await updateGrindingPlanningBoardResourceMinutesSource({ siteKey: key.siteKey, resourceCd: ' 305 ', source: 'own' });
    expect(mocks.sources.upsert).toHaveBeenCalledWith({ where: { csvDashboardId_siteKey_resourceCd: key },
      create: { ...key, source: 'own' }, update: { source: 'own' } });
    await updateGrindingPlanningBoardResourceMinutesSource({ ...key, source: 'original' });
    expect(mocks.sources.deleteMany).toHaveBeenCalledWith({ where: key });
    expect(mocks.values.deleteMany).not.toHaveBeenCalled();
  });
  it.each([0, 0.5, 100000])('upserts per-unit minutes %s and setup', async (perUnitMinutes) => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, resourceCd: ' 305 ', fhincd: ' part ', perUnitMinutes });
    expect(mocks.values.upsert).toHaveBeenCalledWith({
      where: { csvDashboardId_siteKey_resourceCd_fhincd: { ...key, fhincd: 'part' } },
      create: { ...key, fhincd: 'part', perUnitMinutes, setupMinutes: 30 }, update: { perUnitMinutes, setupMinutes: 30 }, include: { ops: true }
    });
  });
  it('deletes only the requested value on null', async () => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: null });
    expect(mocks.values.deleteMany).toHaveBeenCalledWith({ where: { ...key, fhincd: 'part' } });
    expect(mocks.sources.deleteMany).not.toHaveBeenCalled();
  });
  it.each([
    { resourceCd: '' }, { resourceCd: 'x'.repeat(21) }, { fhincd: ' ' }, { fhincd: 'x'.repeat(121) },
    { perUnitMinutes: -1 }, { perUnitMinutes: NaN }, { perUnitMinutes: Infinity }, { perUnitMinutes: 100001 },
    { setupMinutes: -1 }, { setupMinutes: 0.5 }, { setupMinutes: 100001 }
  ])('rejects invalid values before persistence: %j', async (patch) => {
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ...patch })).rejects.toThrow();
    expect(mocks.values.upsert).not.toHaveBeenCalled();
    expect(mocks.values.deleteMany).not.toHaveBeenCalled();
  });
  it('accepts the existing 120-character FHINCD capacity', async () => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, fhincd: 'x'.repeat(120) });
    expect(mocks.values.upsert).toHaveBeenCalled();
  });
  it('rejects an invalid source', async () => {
    // @ts-expect-error exercise an untyped caller
    await expect(updateGrindingPlanningBoardResourceMinutesSource({ ...key, source: 'other' })).rejects.toThrow();
    expect(mocks.sources.upsert).not.toHaveBeenCalled();
  });
  it('registers/replaces operations atomically and derives perUnitMinutes from their sum', async () => {
    const ops = [{ opNo: 1, minutes: 1.5 }, { opNo: 3, minutes: 2.25 }];
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops });
    expect(mocks.ops.deleteMany).toHaveBeenCalledWith({ where: { partMinutesId: 'part-id' } });
    expect(mocks.ops.createMany).toHaveBeenCalledWith({ data: ops.map((op) => ({ ...op, partMinutesId: 'part-id' })) });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 3.75 } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it('removes all operations on an empty array and keeps the supplied per-unit value', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 4 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [] });
    expect(mocks.ops.deleteMany).toHaveBeenCalled();
    expect(mocks.ops.createMany).not.toHaveBeenCalled();
    expect(mocks.values.update).not.toHaveBeenCalled();
  });
  it('preserves operations and their total when an older caller omits ops', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 4 }, { opNo: 2, minutes: 3 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: 7 });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 7 } });
  });
  it('rejects an omitted ops update that disagrees with the saved operation total', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 4 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value }))
      .rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_MINUTES_MISMATCH' });
    expect(mocks.values.update).not.toHaveBeenCalled();
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([0.3, 0.3000005, 0.2999995])('accepts floating-point totals within 1e-6: %s', async (perUnitMinutes) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 0.1 }, { opNo: 2, minutes: 0.2 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 0.1 + 0.2 } });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([0.300002, 0.299998])('rejects totals outside 1e-6: %s', async (perUnitMinutes) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 0.1 }, { opNo: 2, minutes: 0.2 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes }))
      .rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_MINUTES_MISMATCH' });
    expect(mocks.values.update).not.toHaveBeenCalled();
  });
  it('reads ordered operations for each part', async () => {
    const ops = [{ opNo: 1, minutes: 2 }];
    mocks.values.findMany.mockResolvedValue([{ ...value, ops }]);
    expect((await getGrindingPlanningBoardResourceMinutes({ siteKey: key.siteKey })).values[0].ops).toEqual(ops);
    expect(mocks.values.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
      ops: { select: { opNo: true, minutes: true }, orderBy: { opNo: 'asc' } }
    }) }));
  });
  it.each([
    [{ opNo: 0, minutes: 1 }], [{ opNo: 21, minutes: 1 }], [{ opNo: 1.5, minutes: 1 }],
    [{ opNo: 1, minutes: 0 }], [{ opNo: 1, minutes: -1 }], [{ opNo: 1, minutes: Infinity }],
    [{ opNo: 1, minutes: 100001 }], [{ opNo: 1, minutes: 1 }, { opNo: 1, minutes: 2 }],
    [{ opNo: 1, minutes: 100000 }, { opNo: 2, minutes: 1 }],
    Array.from({ length: 21 }, (_, i) => ({ opNo: i + 1, minutes: 1 }))
  ])('rejects invalid operations %j', async (...ops) => {
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

});
