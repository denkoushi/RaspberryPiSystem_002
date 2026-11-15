import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshSiteDirectory, resetSiteDirectoryForTest } from '../../../lib/site-directory.js';
import { resolveSiteKey } from '../../../lib/location-scope-resolver.js';

const mocks = vi.hoisted(() => ({ tx: {} as Record<string, any>, critical: vi.fn(), lock: vi.fn(), reconcile: vi.fn() }));
vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: new Proxy({}, { get: (_, key) => key === '$transaction'
  ? async (fn: (tx: unknown) => unknown) => fn(mocks.tx) : mocks.tx[String(key)] }) }));
vi.mock('../fkojunst-status-mail-critical-lock.js', () => ({ acquireFkojunstStatusMailCriticalTransactionLock: mocks.critical }));
vi.mock('../sessaku-pieces/piece-operation-definitions.js', () => ({ lockOperationDefinitionPieces: mocks.lock, reconcileOperationDefinitionPieces: mocks.reconcile }));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: async () => ({}), isProductionScheduleGrindingResourceCd: (cd: string) => cd === '305',
  isProductionScheduleCuttingResourceCd: (cd: string) => cd !== '10' && cd !== '305'
}));
import { getSameModelResourceGroups, replaceSameModelResourceGroups } from '../same-model-resource-groups.service.js';
import { getGrindingPlanningBoardResourceMinutes, updateGrindingPlanningBoardResourceMinutesSource, updateGrindingPlanningBoardResourcePartMinutes } from '../grinding-planning-board-resource-minutes.service.js';
import { resolveOpBarMinutes } from '../grinding-planning-board-op-bar-load.js';
import { resolveRequiredMinutes } from '../grinding-planning-board-required-minutes.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

type Value = { id: string; siteKey: string; resourceCd: string; fhincd: string; perUnitMinutes: number; setupMinutes: number; ops: Array<{ id: string; opNo: number; minutes: number; setupMinutes: number | null }> };
let values: Value[], groups: Array<{ id?: string; siteKey: string; members: Array<{ resourceCd: string }> }>, sources: Array<{ siteKey: string; resourceCd: string; source: string }>;
const siteKey = 'same-model-site';
const where = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey };
const value = (resourceCd: string, fhincd = 'P'): Value => ({ id: `${resourceCd}-${fhincd}`, siteKey, resourceCd, fhincd, perUnitMinutes: 5, setupMinutes: 10,
  ops: [{ id: `${resourceCd}-op1`, opNo: 1, minutes: 2, setupMinutes: 10 }, { id: `${resourceCd}-op2`, opNo: 2, minutes: 3, setupMinutes: null }] });
const saveGroups = (...members: string[][]) => replaceSameModelResourceGroups({ location: siteKey, groups: members.map((resourceCds) => ({ resourceCds })) });
const matches = (row: any, query: any): boolean => Object.entries(query ?? {}).every(([key, expected]: [string, any]) => {
  if (key === 'csvDashboardId') return true;
  if (typeof expected === 'object' && expected !== null) return expected.in ? expected.in.includes(row[key]) : expected.notIn ? !expected.notIn.includes(row[key]) : true;
  return row[key] === expected;
});
beforeEach(() => {
  vi.clearAllMocks(); resetSiteDirectoryForTest(); values = []; groups = []; sources = [];
  mocks.lock.mockResolvedValue([]);
  mocks.tx.productionScheduleSameModelResourceGroup = {
    findMany: vi.fn(async ({ where }: any) => groups.filter((g) => matches(g, where))),
    deleteMany: vi.fn(async ({ where }: any) => { groups = groups.filter((g) => !matches(g, where)); }),
    create: vi.fn(async ({ data }: any) => { const group = { id: `group-${groups.length}`, siteKey: data.siteKey, members: [] }; groups.push(group); return group; })
  };
  mocks.tx.productionScheduleSameModelResourceMember = {
    createMany: vi.fn(async ({ data }: any) => { for (const member of data) groups.find((g: any) => g.id === member.groupId)!.members.push({ resourceCd: member.resourceCd }); })
  };
  mocks.tx.productionScheduleResourceMaster = { findMany: vi.fn(async () => ['021', '022', '023', '305', '10'].map((resourceCd) => ({ resourceCd, resourceName: `Machine ${resourceCd}` }))) };
  mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes = {
    findMany: vi.fn(async ({ where }: any) => structuredClone(values.filter((row) => matches(row, where)))),
    findUnique: vi.fn(async ({ where }: any) => values.find((row) => matches(row, where.csvDashboardId_siteKey_resourceCd_fhincd)) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const { ops, ...parent } = data;
      const row = values.find((row) => row.id === where.id)!;
      Object.assign(row, parent);
      if (ops) {
        const removed = new Set((ops.deleteMany ?? []).map((op: any) => op.id));
        row.ops = row.ops.filter((op) => !removed.has(op.id));
        for (const { where: target, data: patch } of ops.update ?? []) Object.assign(row.ops.find((op) => op.id === target.id)!, patch);
        row.ops.push(...(ops.create ?? []).map((op: any, index: number) => ({ ...op, id: `updated-${index}` })));
        row.ops.sort((a, b) => a.opNo - b.opNo);
      }
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: any) => { values = values.filter((row) => !matches(row, where)); }),
    create: vi.fn(async ({ data }: any) => { const row = { ...data, id: `copy-${values.length}`, ops: data.ops.create.map((op: any, i: number) => ({ ...op, id: `copy-op-${i}` })) }; values.push(row); return row; }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      let row = values.find((row) => matches(row, where.csvDashboardId_siteKey_resourceCd_fhincd));
      if (row) Object.assign(row, update); else { row = { ...create, id: 'saved', ops: [] }; values.push(row!); }
      return structuredClone(row);
    })
  };
  mocks.tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes = { findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() };
  mocks.tx.productionScheduleGrindingPlanningBoardResourceMinutesSource = {
    findMany: vi.fn(async ({ where }: any) => sources.filter((row) => matches(row, where))),
    createMany: vi.fn(async ({ data }: any) => { for (const row of data) if (!sources.some((source) => source.siteKey === row.siteKey && source.resourceCd === row.resourceCd)) sources.push(row); }),
    upsert: vi.fn(async ({ create }: any) => { if (!sources.some((row) => matches(row, { siteKey: create.siteKey, resourceCd: create.resourceCd }))) sources.push(create); }),
    deleteMany: vi.fn(async ({ where }: any) => { sources = sources.filter((row) => !matches(row, where)); })
  };
});

describe('same-model group migration and shared minutes', () => {
  it.each(['shared', ' shared ', 'shared - terminal'])('rejects resolved shared site before any transaction: %s', async (location) => {
    await expect(replaceSameModelResourceGroups({ location, groups: [] })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.critical).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSameModelResourceGroup.findMany).not.toHaveBeenCalled();
  });
  it('does not read, lock or mutate values when only group/member ordering changes', async () => {
    groups = [{ siteKey, members: [{ resourceCd: '021' }, { resourceCd: '022' }] },
      { siteKey, members: [{ resourceCd: '023' }, { resourceCd: '305' }] }];
    values = [value('021'), value('023', 'UNCHANGED')];
    const before = structuredClone(values);
    await saveGroups(['305', '023'], ['022', '021']);
    expect(values).toEqual(before);
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    for (const name of ['update', 'create', 'deleteMany']) expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes[name]).not.toHaveBeenCalled();
  });
  it('limits migration, piece locks and reconciliation to machines whose membership changes', async () => {
    groups = [{ siteKey, members: [{ resourceCd: '021' }, { resourceCd: '022' }] },
      { siteKey, members: [{ resourceCd: '023' }, { resourceCd: '024' }] }];
    values = [value('021', 'STABLE'), value('023')];
    const unchanged = structuredClone(values[0]);
    await saveGroups(['022', '021'], ['023', '024', '025']);
    const parts = mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes;
    expect(parts.findMany).toHaveBeenCalledExactlyOnceWith({ where: { ...where, resourceCd: { in: ['023', '024', '025'] } }, include: { ops: { orderBy: { opNo: 'asc' } } } });
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(mocks.tx, 'P');
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(mocks.tx, { siteKey, resourceCd: '023' }, [], [1, 2]);
    expect(parts.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { ...where, resourceCd: { in: ['023', '024', '025'] }, id: { notIn: ['023-P'] } } });
    expect(values.find((row) => row.resourceCd === '021')).toEqual(unchanged);
    expect(values.find((row) => row.resourceCd === '023')).toEqual(value('023'));
    expect(parts.update).not.toHaveBeenCalled();
    expect(parts.create).not.toHaveBeenCalled();
  });
  it.each([{ members: [['021']] }, { members: [[]] }, { members: [['021', '021']] }, { members: [['021', '022'], ['022', '023']] }])('rejects invalid groups before writes: $members', async ({ members }) => {
    await expect(saveGroups(...members)).rejects.toThrow();
    expect(mocks.critical).not.toHaveBeenCalled();
  });
  it('waits for the common definition/piece lock before reading or changing membership', async () => {
    let release!: () => void;
    mocks.critical.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const saving = saveGroups(['021', '022']);
    expect(mocks.tx.productionScheduleSameModelResourceGroup.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update).not.toHaveBeenCalled();
    release(); await saving;
  });
  it('offers machines absent from imports/board from the complete master', async () => {
    const result = await getSameModelResourceGroups(siteKey);
    expect(result.resources.map((row) => row.resourceCd)).toEqual(['021', '022', '023', '305']);
  });
  it('merges one-sided parts and operations into the string-minimum representative and aligns own source', async () => {
    values = [value('022'), value('021', 'Q')]; sources = [{ siteKey, resourceCd: '022', source: 'own' }];
    await saveGroups(['022', '021']);
    expect(values.map((row) => [row.resourceCd, row.fhincd])).toEqual([['021', 'P'], ['021', 'Q']]);
    expect(values[0].ops[0].id).toBe('022-op1');
    expect(sources.map((row) => row.resourceCd).sort()).toEqual(['021', '022']);
    const read = await getGrindingPlanningBoardResourceMinutes({ siteKey });
    expect(read.values.filter((row) => row.fhincd === 'P').map((row) => row.resourceCd)).toEqual(['021', '022']);
    expect(read.values.filter((row) => row.fhincd === 'P').map((row) => row.ops)).toEqual([values[0].ops, values[0].ops]);
    expect(resolveOpBarMinutes({ opBarSourceResourceCd: '022', opBarFromOpNo: 2 }, 2, 'P', read)).toEqual({ requiredMinutes: 6, isCompleted: false });
  });
  it.each(['parent', 'setup', 'op-minute', 'op-setup', 'op-number'])('rejects conflicting %s with 409 and all affected parts before mutations', async (field) => {
    values = [value('021'), value('022'), value('021', 'Q'), value('022', 'Q')];
    for (const row of values.filter((row) => row.resourceCd === '022')) {
      if (field === 'parent') row.perUnitMinutes++;
      if (field === 'setup') row.setupMinutes++;
      if (field === 'op-minute') row.ops[0].minutes++;
      if (field === 'op-setup') row.ops[0].setupMinutes = null;
      if (field === 'op-number') row.ops[0].opNo = 3;
    }
    await expect(saveGroups(['021', '022'])).rejects.toMatchObject({ statusCode: 409, details: { fhincds: ['P', 'Q'] } });
    expect(mocks.tx.productionScheduleSameModelResourceGroup.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update).not.toHaveBeenCalled();
  });
  it('deduplicates identical definitions despite distinct operation IDs', async () => {
    values = [value('021'), value('022')]; await saveGroups(['021', '022']);
    expect(values).toHaveLength(1); expect(values[0].id).toBe('021-P');
  });
  it('moves the representative row with its operation IDs when a smaller member joins', async () => {
    values = [value('022')]; await saveGroups(['022', '023']); await saveGroups(['021', '022', '023']);
    expect(values).toHaveLength(1); expect(values[0]).toMatchObject({ id: '022-P', resourceCd: '021', ops: [{ id: '022-op1' }, { id: '022-op2' }] });
  });
  it.each(['021', '023'])('leaves a copy for a removed member %s, including the former representative', async (removed) => {
    values = [value('021')]; await saveGroups(['021', '022', '023']);
    await saveGroups(['021', '022', '023'].filter((cd) => cd !== removed));
    expect(values.map((row) => row.resourceCd).sort()).toEqual(removed === '021' ? ['021', '022'] : ['021', '023']);
    expect(values.find((row) => row.resourceCd === removed)?.ops.map(({ opNo, minutes }) => [opNo, minutes])).toEqual([[1, 2], [2, 3]]);
  });
  it('keeps standalone copies when the entire group is dissolved and respects site boundaries', async () => {
    values = [value('021'), { ...value('021', 'OTHER'), siteKey: 'other' }];
    await saveGroups(['021', '022']); await saveGroups();
    expect(values.filter((row) => row.siteKey === siteKey).map((row) => row.resourceCd).sort()).toEqual(['021', '022']);
    expect(values.filter((row) => row.siteKey === 'other')).toHaveLength(1);
  });
  it('saves on 022 against the 021 baseline; both machines use the new time and source toggles together', async () => {
    values = [{ ...value('021'), ops: [] }]; await saveGroups(['021', '022']);
    const read = await updateGrindingPlanningBoardResourcePartMinutes({ siteKey, resourceCd: '022', fhincd: 'P', perUnitMinutes: 8, setupMinutes: 10,
      expectedMinutes: { perUnitMinutes: 5, setupMinutes: 10, ops: [] }, expectedOpIds: [] });
    expect(values).toHaveLength(1); expect(values[0]).toMatchObject({ resourceCd: '021', perUnitMinutes: 8 });
    expect(resolveRequiredMinutes({ effectiveResourceCd: '021', fhincd: 'P', quantity: 2, originalMinutes: 1, originalKnown: true }, read)).toMatchObject({ requiredMinutes: 26, requiredMinutesSource: 'own' });
    expect(read.ownSourceResourceCds.sort()).toEqual(['021', '022']);
    const original = await updateGrindingPlanningBoardResourceMinutesSource({ siteKey, resourceCd: '022', source: 'original' });
    expect(original.ownSourceResourceCds).toEqual([]);
    const own = await updateGrindingPlanningBoardResourceMinutesSource({ siteKey, resourceCd: '021', source: 'own' });
    expect(own.ownSourceResourceCds.sort()).toEqual(['021', '022']);
    await expect(updateGrindingPlanningBoardResourcePartMinutes({ siteKey, resourceCd: '022', fhincd: 'P', perUnitMinutes: 9, setupMinutes: 10,
      expectedMinutes: { perUnitMinutes: 5, setupMinutes: 10, ops: [] } })).rejects.toMatchObject({ statusCode: 409 });
  });
});

it('uses the same explicit site as the kiosk even when the location label has a different prefix', async () => {
  const client = { name: 'kiosk', location: '表示工場 - HCN', siteKey: 'canonical-site' };
  await refreshSiteDirectory({ clientDevice: { findMany: async () => [client] }, site: { findMany: async () => [{ key: 'canonical-site' }] } });
  const result = await getSameModelResourceGroups(client.location);
  expect(result.siteKey).toBe(resolveSiteKey(client));
  expect(result.siteKey).toBe('canonical-site');
  resetSiteDirectoryForTest();
});

it('returns each machine value for unresolved conflicts and does not write', async () => {
  values = [value('021'), { ...value('022'), perUnitMinutes: 9 }];
  await expect(saveGroups(['021', '022'])).rejects.toMatchObject({ statusCode: 409, details: {
    fhincds: ['P'], values: { P: { '021': { perUnitMinutes: 5, setupMinutes: 10, ops: [{ opNo: 1, setupMinutes: 10, minutes: 2 }, { opNo: 2, setupMinutes: null, minutes: 3 }] }, '022': { perUnitMinutes: 9 } } }
  } });
  expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.update).not.toHaveBeenCalled();
});
it.each(['021', '022'])('uses the selected %s values including operations at the existing representative', async (selected) => {
  values = [value('021'), { ...value('022'), perUnitMinutes: 9, setupMinutes: 20, ops: [{ id: 'selected-op', opNo: 3, setupMinutes: 20, minutes: 9 }] }];
  const expected = structuredClone(values.find((row) => row.resourceCd === selected)!);
  await replaceSameModelResourceGroups({ location: siteKey, groups: [{ resourceCds: ['021', '022'] }], resolutions: { P: selected } });
  expect(values).toHaveLength(1);
  expect(values[0]).toMatchObject({ resourceCd: '021', perUnitMinutes: expected.perUnitMinutes, setupMinutes: expected.setupMinutes });
  expect(values[0].ops.map(({ opNo, setupMinutes, minutes }) => ({ opNo, setupMinutes, minutes }))).toEqual(expected.ops.map(({ opNo, setupMinutes, minutes }) => ({ opNo, setupMinutes, minutes })));
});
it('keeps the representative operation IDs when the selected value has the same operation numbers', async () => {
  values = [value('021'), { ...value('022'), ops: [{ id: '022-op1', opNo: 1, setupMinutes: 10, minutes: 4 }, { id: '022-op2', opNo: 2, setupMinutes: null, minutes: 3 }] }];
  await replaceSameModelResourceGroups({ location: siteKey, groups: [{ resourceCds: ['021', '022'] }], resolutions: { P: '022' } });
  expect(values).toHaveLength(1);
  expect(values[0].ops).toMatchObject([{ id: '021-op1', opNo: 1, minutes: 4 }, { id: '021-op2', opNo: 2, minutes: 3 }]);
});
it('uses a selected member previous representative row', async () => {
  values = [value('021'), { ...value('023'), perUnitMinutes: 9 }];
  await saveGroups(['021', '022']);
  await replaceSameModelResourceGroups({ location: siteKey, groups: [{ resourceCds: ['021', '022', '023'] }], resolutions: { P: '022' } });
  expect(values).toHaveLength(1);
  expect(values[0]).toMatchObject({ resourceCd: '021', perUnitMinutes: 5 });
});
it.each(['099', '023'])('rejects a resolution without a conflicting source row: %s', async (resourceCd) => {
  values = [value('021'), { ...value('022'), perUnitMinutes: 9 }];
  await expect(replaceSameModelResourceGroups({ location: siteKey, groups: [{ resourceCds: ['021', '022', '023'] }], resolutions: { P: resourceCd } })).rejects.toMatchObject({ statusCode: 400 });
  expect(mocks.tx.productionScheduleSameModelResourceGroup.deleteMany).not.toHaveBeenCalled();
});
it('keeps unselected conflicts at 409 even with a partial resolution', async () => {
  values = [value('021'), { ...value('022'), perUnitMinutes: 9 }, value('021', 'Q'), { ...value('022', 'Q'), perUnitMinutes: 8 }];
  await expect(replaceSameModelResourceGroups({ location: siteKey, groups: [{ resourceCds: ['021', '022'] }], resolutions: { P: '022' } })).rejects.toMatchObject({ statusCode: 409, details: { fhincds: ['P', 'Q'], values: { Q: { '022': { perUnitMinutes: 8 } } } } });
});
