import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sources: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  values: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleGrindingPlanningBoardResourceMinutesSource: mocks.sources,
  productionScheduleGrindingPlanningBoardResourcePartMinutes: mocks.values
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
      create: { ...key, fhincd: 'part', perUnitMinutes, setupMinutes: 30 }, update: { perUnitMinutes, setupMinutes: 30 }
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
});
