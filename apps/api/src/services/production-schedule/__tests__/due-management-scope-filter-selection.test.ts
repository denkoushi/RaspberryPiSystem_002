import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    productionScheduleTriageSelection: { deleteMany: vi.fn(), upsert: vi.fn() }
  };
  return {
    tx,
    queryRaw: vi.fn(),
    findMany: vi.fn(),
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    policy: vi.fn(),
    resolveSiteKey: vi.fn()
  };
});

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    productionScheduleTriageSelection: { findMany: mocks.findMany }
  }
}));
vi.mock('../../../lib/site-directory.js', () => ({ resolveSiteKeyForScopeKey: mocks.resolveSiteKey }));
vi.mock('../row-resolver/index.js', () => ({ buildMaxProductNoWinnerCondition: () => Prisma.sql`TRUE` }));
vi.mock('../policies/resource-category-policy.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../policies/resource-category-policy.service.js')>()),
  getResourceCategoryPolicy: mocks.policy
}));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  GLOBAL_SHARED_LOCATION_KEY,
  resolveRankingScopePolicy
} from '../due-management-ranking-scope-policy.service.js';
import {
  hasDueManagementResourceFilter,
  listDueManagementFilteredFseibans,
  normalizeDueManagementResourceFilter
} from '../due-management-resource-filter.service.js';
import {
  getDueManagementTriageSelections,
  replaceDueManagementTriageSelections
} from '../due-management-selection.service.js';

const lastSql = (): Prisma.Sql => {
  const [strings, ...values] = mocks.queryRaw.mock.lastCall as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
};

beforeEach(() => {
  mocks.queryRaw.mockReset().mockResolvedValue([]);
  mocks.findMany.mockReset();
  mocks.transaction.mockClear();
  mocks.tx.productionScheduleTriageSelection.deleteMany.mockReset();
  mocks.tx.productionScheduleTriageSelection.upsert.mockReset();
  mocks.policy.mockReset().mockResolvedValue({ grindingResourceCds: ['305', '581'], cuttingExcludedResourceCds: ['10', 'MSZ'] });
  mocks.resolveSiteKey.mockReset().mockImplementation((key: string) => `site:${key}`);
});

describe('resolveRankingScopePolicy', () => {
  it('defaults to globalShared stored under the site key of the target', () => {
    expect(resolveRankingScopePolicy({ actorLocation: 'actor', targetLocation: 'target' })).toEqual({
      scope: 'globalShared',
      rankLocationKey: 'site:target',
      targetLocation: 'target',
      actorLocation: 'actor'
    });
    expect(mocks.resolveSiteKey).toHaveBeenCalledWith('target');
  });

  it.each([null, '', 'unknown', 'GLOBALSHARED'])('falls back to globalShared for %j', (requestedScope) => {
    expect(resolveRankingScopePolicy({ requestedScope, actorLocation: 'a', targetLocation: 't' }).scope).toBe('globalShared');
  });

  it('stores locationScoped ranks under the target location itself (trimmed scope)', () => {
    expect(resolveRankingScopePolicy({ requestedScope: ' locationScoped ', actorLocation: 'a', targetLocation: 't' })).toEqual({
      scope: 'locationScoped',
      rankLocationKey: 't',
      targetLocation: 't',
      actorLocation: 'a'
    });
  });

  it('stores localTemporary ranks under the legacy shared key', () => {
    expect(
      resolveRankingScopePolicy({ requestedScope: 'localTemporary', actorLocation: 'a', targetLocation: 't' }).rankLocationKey
    ).toBe(GLOBAL_SHARED_LOCATION_KEY);
    expect(GLOBAL_SHARED_LOCATION_KEY).toBe('shared-global-rank');
  });

  it('propagates site directory failures even for non-global scopes', () => {
    mocks.resolveSiteKey.mockImplementation(() => {
      throw new Error('SITE_DIRECTORY_UNAVAILABLE');
    });
    expect(() =>
      resolveRankingScopePolicy({ requestedScope: 'locationScoped', actorLocation: 'a', targetLocation: 't' })
    ).toThrow('SITE_DIRECTORY_UNAVAILABLE');
  });
});

describe('due management resource filter', () => {
  it('normalizes resource code to trimmed upper-case and detects active filters', () => {
    expect(normalizeDueManagementResourceFilter({ resourceCd: ' msz ' })).toEqual({ resourceCd: 'MSZ', resourceCategory: undefined });
    expect(normalizeDueManagementResourceFilter(undefined)).toEqual({ resourceCd: '', resourceCategory: undefined });
    expect(hasDueManagementResourceFilter(undefined)).toBe(false);
    expect(hasDueManagementResourceFilter({ resourceCd: '   ' })).toBe(false);
    expect(hasDueManagementResourceFilter({ resourceCd: 'r1' })).toBe(true);
    expect(hasDueManagementResourceFilter({ resourceCategory: 'grinding' })).toBe(true);
  });

  it('returns [] without querying when an explicit target list is blank', async () => {
    const result = await listDueManagementFilteredFseibans({
      locationScope: { deviceScopeKey: 'dev', siteKey: 'site' },
      targetFseibans: [' ', ''],
      filter: { resourceCd: 'R1' }
    });
    expect(result).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.policy).not.toHaveBeenCalled();
  });

  it('filters by grinding resources from the scope policy', async () => {
    mocks.queryRaw.mockResolvedValue([{ fseiban: ' A ' }, { fseiban: '  ' }, { fseiban: 'B' }]);
    const result = await listDueManagementFilteredFseibans({
      locationScope: { deviceScopeKey: ' dev ', siteKey: ' site ' },
      targetFseibans: [' A ', 'B', 'A'],
      filter: { resourceCategory: 'grinding' }
    });
    expect(result).toEqual(['A', 'B']);
    expect(mocks.policy).toHaveBeenCalledWith({ siteKey: 'site', deviceScopeKey: 'dev' });
    const sql = lastSql();
    expect(sql.text).toMatch(/UPPER\(BTRIM\("CsvDashboardRow"\."rowData"->>'FSIGENCD'\)\) IN \(\?,\?\)|IN \(\$\d+,\$\d+\)/);
    expect(sql.values).toEqual(expect.arrayContaining([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'A', 'B', '305', '581']));
    expect(sql.text).not.toContain('NOT IN');
  });

  it('cutting category excludes both grinding and cutting-excluded codes', async () => {
    await listDueManagementFilteredFseibans({
      locationScope: { deviceScopeKey: 'dev', siteKey: 'site' },
      filter: { resourceCategory: 'cutting', resourceCd: ' r9 ' }
    });
    const sql = lastSql();
    expect(sql.text.match(/NOT IN/g)).toHaveLength(2);
    expect(sql.values).toEqual(expect.arrayContaining(['305', '581', '10', 'MSZ', 'R9']));
  });

  it('cutting category with no excluded codes only excludes grinding codes', async () => {
    mocks.policy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: [] });
    await listDueManagementFilteredFseibans({
      locationScope: { deviceScopeKey: 'dev', siteKey: 'site' },
      filter: { resourceCategory: 'cutting' }
    });
    const sql = lastSql();
    expect(sql.text.match(/NOT IN/g)).toHaveLength(1);
    expect(sql.values).toContain('305');
  });

  it('adds no category/target/resource conditions when filter is empty', async () => {
    await listDueManagementFilteredFseibans({
      locationScope: { deviceScopeKey: 'dev', siteKey: 'site' },
      filter: {}
    });
    const sql = lastSql();
    expect(sql.text).not.toMatch(/NOT IN| IN \(/);
    expect(sql.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID]);
  });
});

describe('due management triage selection', () => {
  it('reads selections newest first for the location', async () => {
    mocks.findMany.mockResolvedValue([{ fseiban: 'B' }, { fseiban: 'A' }]);
    expect(await getDueManagementTriageSelections('loc')).toEqual(['B', 'A']);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'loc' },
        orderBy: [{ selectedAt: 'desc' }, { fseiban: 'asc' }]
      })
    );
  });

  it('removes unselected rows and upserts the normalized selection', async () => {
    const result = await replaceDueManagementTriageSelections({ locationKey: 'loc', selectedFseibans: [' A ', 'B', 'A', ''] });
    expect(result).toEqual(['A', 'B']);
    expect(mocks.tx.productionScheduleTriageSelection.deleteMany).toHaveBeenCalledWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'loc', fseiban: { notIn: ['A', 'B'] } }
    });
    const upserts = mocks.tx.productionScheduleTriageSelection.upsert.mock.calls.map((c) => c[0]);
    expect(upserts.map((u) => u.create.fseiban)).toEqual(['A', 'B']);
    expect(upserts[0].where.csvDashboardId_location_fseiban).toEqual({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: 'loc',
      fseiban: 'A'
    });
    expect(upserts[0].update.selectedAt).toBeInstanceOf(Date);
  });

  it('clears every selection for the location when the new selection is empty', async () => {
    await replaceDueManagementTriageSelections({ locationKey: 'loc', selectedFseibans: ['  '] });
    expect(mocks.tx.productionScheduleTriageSelection.deleteMany).toHaveBeenCalledWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'loc' }
    });
    expect(mocks.tx.productionScheduleTriageSelection.upsert).not.toHaveBeenCalled();
  });
});
