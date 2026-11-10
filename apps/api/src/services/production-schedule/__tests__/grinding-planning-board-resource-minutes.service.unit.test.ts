import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sessaku-pieces/piece-operation-definitions.js', () => ({ lockOperationDefinitionPieces: vi.fn(), reconcileOperationDefinitionPieces: vi.fn() }));
import { lockOperationDefinitionPieces, reconcileOperationDefinitionPieces } from '../sessaku-pieces/piece-operation-definitions.js';

const mocks = vi.hoisted(() => ({
  sources: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  values: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  ops: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() }, transaction: vi.fn()
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
    vi.mocked(lockOperationDefinitionPieces).mockResolvedValue([]);
    mocks.sources.findMany.mockResolvedValue([]);
    mocks.values.findMany.mockResolvedValue([]);
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [] });
    mocks.ops.findMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation((callback) => callback({
      productionScheduleGrindingPlanningBoardResourcePartMinutes: mocks.values,
      productionScheduleGrindingPlanningBoardResourcePartOpMinutes: mocks.ops
    }));
  });
  it.each([0, 10, null])('rejects stale IDs without ops or writes, perUnitMinutes: %s', async (perUnitMinutes) => {
    mocks.values.findUnique.mockResolvedValue({ ops: [{ id: 'remote-1', opNo: 1 }, { id: 'remote-2', opNo: 2 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({
      siteKey: key.siteKey, ...value, perUnitMinutes, expectedOpIds: []
    })).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_SET_CHANGED' });
    expect(lockOperationDefinitionPieces).toHaveBeenCalledTimes(1);
    for (const write of [mocks.values.upsert, mocks.values.deleteMany, mocks.values.update, mocks.ops.deleteMany, mocks.ops.createMany, mocks.ops.update, reconcileOperationDefinitionPieces]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
  it('waits for the lock before checking IDs and preserves matching operations when ops is omitted', async () => {
    let unlock!: () => void;
    vi.mocked(lockOperationDefinitionPieces).mockReturnValueOnce(new Promise((resolve) => { unlock = () => resolve([]); }));
    const ops = [{ id: 'op-1', opNo: 1, minutes: 10, setupMinutes: 30 }];
    mocks.values.findUnique.mockResolvedValue({ ops });
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops });
    mocks.ops.findMany.mockResolvedValue(ops);
    const saving = updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: 10, expectedOpIds: ['op-1'] });
    expect(lockOperationDefinitionPieces).toHaveBeenCalledTimes(1);
    expect(mocks.values.findUnique).not.toHaveBeenCalled();
    expect(mocks.values.upsert).not.toHaveBeenCalled();
    unlock();
    await expect(saving).resolves.toMatchObject({ savedOpIds: ['op-1'], savedOpNos: [1] });
    expect(mocks.values.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { csvDashboardId_siteKey_resourceCd_fhincd: { ...key, fhincd: 'part' } }, include: { ops: true }
    });
    for (const write of [mocks.ops.deleteMany, mocks.ops.createMany, mocks.ops.update, reconcileOperationDefinitionPieces]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('does not check IDs for legacy requests without expectedOpIds, ops omitted: %s', async (omitted) => {
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ...(omitted ? {} : { ops: [] }) });
    expect(mocks.values.findUnique).not.toHaveBeenCalled();
    expect(mocks.values.upsert).toHaveBeenCalledTimes(1);
    if (omitted) expect(lockOperationDefinitionPieces).not.toHaveBeenCalled();
  });
  it('returns IDs and numbers read after writes inside the transaction even when the later GET differs', async () => {
    let inTransaction = false;
    mocks.transaction.mockImplementation(async (callback) => {
      inTransaction = true;
      const result = await callback({
        productionScheduleGrindingPlanningBoardResourcePartMinutes: mocks.values,
        productionScheduleGrindingPlanningBoardResourcePartOpMinutes: mocks.ops
      });
      inTransaction = false;
      return result;
    });
    mocks.ops.findMany.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      expect(mocks.ops.createMany).toHaveBeenCalledWith({ data: [
        { partMinutesId: 'part-id', opNo: 3, minutes: 2, setupMinutes: 0 }
      ] });
      expect(mocks.values.update).toHaveBeenCalled();
      return [{ id: 'created-3', opNo: 3 }];
    });
    const remote = [{ ...value, ops: [{ id: 'remote-3', opNo: 3, minutes: 9 }] }];
    mocks.values.findMany.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      return remote;
    });
    const response = await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value,
      ops: [{ opNo: 3, minutes: 2, setupMinutes: 0 }], expectedOpIds: [] });
    expect(mocks.ops.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { partMinutesId: 'part-id' }, select: { id: true, opNo: true }, orderBy: { opNo: 'asc' }
    });
    expect(response).toEqual({ ownSourceResourceCds: [], values: remote, savedOpIds: ['created-3'], savedOpNos: [3] });
  });
  it.each([false, true])('returns empty saved operation metadata after clearing operations, row deletion: %s', async (deletion) => {
    mocks.values.findMany.mockResolvedValue([{ ...value, ops: [{ id: 'remote-2', opNo: 2, minutes: 9 }] }]);
    const response = await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value,
      perUnitMinutes: deletion ? null : 5, ops: [], expectedOpIds: [] });
    expect(response).toMatchObject({ savedOpIds: [], savedOpNos: [] });
  });
  it('returns preserved operation metadata when ops is omitted', async () => {
    const ops = [{ id: 'op-3', opNo: 3, minutes: 2, setupMinutes: 30 }];
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops });
    mocks.ops.findMany.mockResolvedValue(ops);
    const response = await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: 2 });
    expect(response).toMatchObject({ savedOpIds: ['op-3'], savedOpNos: [3] });
    expect(mocks.ops.createMany).not.toHaveBeenCalled();
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([false, true])('rejects stale operation replacement/deletion without writes: %s', async (deletion) => {
    mocks.values.findUnique.mockResolvedValue({ ops: [{ id: 'op-1', opNo: 1 }, { id: 'op-3', opNo: 3 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({
      siteKey: key.siteKey, ...value, perUnitMinutes: deletion ? null : 3,
      ...(deletion ? {} : { ops: [{ opNo: 1, minutes: 3 }] }), expectedOpIds: ['old-1']
    })).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_SET_CHANGED',
      message: '他の端末で工程が変わりました。表を開き直してください' });
    for (const write of [mocks.values.upsert, mocks.values.deleteMany, mocks.ops.deleteMany, mocks.ops.createMany, mocks.values.update, reconcileOperationDefinitionPieces]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])('rejects reused operation numbers with new IDs without writes: %s', async (deletion) => {
    mocks.values.findUnique.mockResolvedValue({ ops: [{ id: 'old-1', opNo: 1 }, { id: 'recreated-2', opNo: 2 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value,
      perUnitMinutes: deletion ? null : 3, ...(deletion ? {} : { ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 2 }] }),
      expectedOpIds: ['old-1', 'deleted-2']
    })).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_SET_CHANGED' });
    for (const write of [mocks.values.upsert, mocks.values.deleteMany, mocks.ops.deleteMany, mocks.ops.createMany, mocks.ops.update, mocks.values.update, reconcileOperationDefinitionPieces]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
  it('preserves operation IDs on minute/setup changes and ignores request IDs', async () => {
    const ops = [{ id: 'op-1', opNo: 1, minutes: 1, setupMinutes: 5 }, { id: 'op-2', opNo: 2, minutes: 2, setupMinutes: null }];
    mocks.values.findUnique.mockResolvedValue({ ops });
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, expectedOpIds: ['op-2', 'op-1'],
      ops: [{ id: 'ignored', opNo: 1, minutes: 3, setupMinutes: 10 }, { opNo: 2, minutes: 4, setupMinutes: null }] });
    expect(mocks.ops.update.mock.calls).toEqual([
      [{ where: { id: 'op-1' }, data: { minutes: 3, setupMinutes: 10 } }],
      [{ where: { id: 'op-2' }, data: { minutes: 4, setupMinutes: null } }]
    ]);
    expect(mocks.ops.createMany).not.toHaveBeenCalled();
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
    expect(reconcileOperationDefinitionPieces).not.toHaveBeenCalled();
  });
  it('deletes only removed IDs, updates retained IDs, and creates new operations without request IDs', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1 }, { id: 'op-2', opNo: 2 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value,
      ops: [{ id: 'ignored-1', opNo: 1, minutes: 3, setupMinutes: 0 }, { id: 'ignored-3', opNo: 3, minutes: 4, setupMinutes: 0 }] });
    expect(mocks.ops.deleteMany).toHaveBeenCalledWith({ where: { partMinutesId: 'part-id', id: { in: ['op-2'] } } });
    expect(mocks.ops.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'op-1' }, data: { minutes: 3, setupMinutes: 0 } });
    expect(mocks.ops.createMany).toHaveBeenCalledExactlyOnceWith({ data: [{ partMinutesId: 'part-id', opNo: 3, minutes: 4, setupMinutes: 0 }] });
  });
  it('accepts matching unordered operation sets and an empty set for a new row', async () => {
    mocks.values.findUnique.mockResolvedValueOnce({ ops: [{ id: 'op-1', opNo: 1 }, { id: 'op-3', opNo: 3 }] }).mockResolvedValueOnce(null);
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [], expectedOpIds: ['op-3', 'op-1'] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [], expectedOpIds: [] });
    expect(mocks.values.upsert).toHaveBeenCalledTimes(2);
  });
  it.each([30, 40])('preserves legacy setup allocation only when its sum matches %s', async (setupMinutes) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [
      { id: 'op-1', opNo: 1, minutes: 1, setupMinutes: 20 }, { id: 'op-3', opNo: 3, minutes: 1, setupMinutes: 10 }
    ] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, setupMinutes,
      ops: [{ opNo: 3, minutes: 2 }, { opNo: 1, minutes: 3 }, { opNo: 2, minutes: 1 }] });
    expect(mocks.ops.createMany).toHaveBeenCalledWith({ data: [{ partMinutesId: 'part-id', opNo: 2, minutes: 1, setupMinutes: null }] });
    expect(mocks.ops.update).toHaveBeenCalledWith({ where: { id: 'op-3' }, data: { minutes: 2, setupMinutes: setupMinutes === 30 ? 10 : null } });
    expect(mocks.ops.update).toHaveBeenCalledWith({ where: { id: 'op-1' }, data: { minutes: 3, setupMinutes: setupMinutes === 30 ? 20 : 40 } });
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
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
    expect(mocks.ops.createMany).toHaveBeenCalledWith({ data: ops.map((op) => ({ ...op, setupMinutes: op.opNo === 1 ? 30 : null, partMinutesId: 'part-id' })) });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 3.75, setupMinutes: 30 } });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it.each([
    [[{ opNo: 2, minutes: 9 }, { opNo: 1, minutes: 1 }], false],
    [[{ opNo: 1, minutes: 1 }], true],
    [[{ id: 'op-1', opNo: 1, minutes: 4 }, { opNo: 3, minutes: 3 }], true]
  ])('reconciles pieces only when the operation set changes %j', async (ops, reconciles) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4 }, { id: 'op-2', opNo: 2, minutes: 3 }] });
    vi.mocked(reconcileOperationDefinitionPieces).mockClear();
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops });
    expect(mocks.ops.update).toHaveBeenCalled();
    expect(vi.mocked(reconcileOperationDefinitionPieces).mock.calls.length).toBe(reconciles ? 1 : 0);
  });
  it('removes all operations on an empty array and keeps the supplied per-unit value', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [] });
    expect(mocks.ops.deleteMany).toHaveBeenCalled();
    expect(mocks.ops.createMany).not.toHaveBeenCalled();
    expect(mocks.values.update).not.toHaveBeenCalled();
  });
  it('preserves operations and their total when an older caller omits ops', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4 }, { id: 'op-2', opNo: 2, minutes: 3 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, setupMinutes: 0, perUnitMinutes: 7 });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 7, setupMinutes: 0 } });
  });
  it('rejects an omitted ops update that disagrees with the saved operation total', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value }))
      .rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_MINUTES_MISMATCH' });
    expect(mocks.values.update).not.toHaveBeenCalled();
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([0.3, 0.3000005, 0.2999995])('accepts floating-point totals within 1e-6: %s', async (perUnitMinutes) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 0.1 }, { opNo: 2, minutes: 0.2 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, setupMinutes: 0, perUnitMinutes });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 0.1 + 0.2, setupMinutes: 0 } });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([0.300002, 0.299998])('rejects totals outside 1e-6: %s', async (perUnitMinutes) => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 0.1 }, { opNo: 2, minutes: 0.2 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes }))
      .rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_MINUTES_MISMATCH' });
    expect(mocks.values.update).not.toHaveBeenCalled();
  });
  it('reads ordered operations for each part', async () => {
    const ops = [{ id: 'op-1', opNo: 1, minutes: 2, setupMinutes: 15 }];
    mocks.values.findMany.mockResolvedValue([{ ...value, ops }]);
    expect((await getGrindingPlanningBoardResourceMinutes({ siteKey: key.siteKey })).values[0].ops).toEqual(ops);
    expect(mocks.values.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
      ops: { select: { id: true, opNo: true, minutes: true, setupMinutes: true }, orderBy: { opNo: 'asc' } }
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

  it('derives both totals and preserves omitted setup by fixed operation number', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [
      { id: 'op-1', opNo: 1, minutes: 4, setupMinutes: 20 }, { id: 'op-3', opNo: 3, minutes: 3, setupMinutes: 10 }
    ] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [
      { opNo: 3, minutes: 2 }, { opNo: 1, minutes: 5, setupMinutes: null }, { opNo: 2, minutes: 1 }
    ] });
    expect(mocks.ops.createMany).toHaveBeenCalledWith({ data: [{ partMinutesId: 'part-id', opNo: 2, minutes: 1, setupMinutes: null }] });
    expect(mocks.ops.update).toHaveBeenCalledWith({ where: { id: 'op-3' }, data: { minutes: 2, setupMinutes: 10 } });
    expect(mocks.ops.update).toHaveBeenCalledWith({ where: { id: 'op-1' }, data: { minutes: 5, setupMinutes: null } });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 8, setupMinutes: 10 } });
  });
  it('keeps matching setup totals when ops is omitted', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4, setupMinutes: 30 }, { opNo: 3, minutes: 3, setupMinutes: null }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: 7 });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 7, setupMinutes: 30 } });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
    expect(reconcileOperationDefinitionPieces).not.toHaveBeenCalled();
  });
  it('rejects mismatching setup totals when ops is omitted', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ id: 'op-1', opNo: 1, minutes: 4, setupMinutes: 20 }] });
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, perUnitMinutes: 4 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'OPERATION_SETUP_MISMATCH' });
    expect(mocks.values.update).not.toHaveBeenCalled();
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, 100001, NaN, Infinity])('rejects invalid operation setup %s', async (setupMinutes) => {
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [{ opNo: 1, minutes: 1, setupMinutes }] })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('accepts setup total 100000 and rejects overflow including preserved setup', async () => {
    mocks.values.upsert.mockResolvedValue({ id: 'part-id', ops: [{ opNo: 1, minutes: 1, setupMinutes: 100000 }] });
    await updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, setupMinutes: 100000, ops: [{ opNo: 1, minutes: 1 }] });
    expect(mocks.values.update).toHaveBeenCalledWith({ where: { id: 'part-id' }, data: { perUnitMinutes: 1, setupMinutes: 100000 } });
    mocks.ops.deleteMany.mockClear();
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey: key.siteKey, ...value, ops: [{ opNo: 1, minutes: 1 }, { opNo: 2, minutes: 1, setupMinutes: 1 }] })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.ops.deleteMany).not.toHaveBeenCalled();
  });

});
