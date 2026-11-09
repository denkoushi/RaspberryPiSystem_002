import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacity = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleGrindingPlanningBoardResourceCapacity: capacity } }));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  getGrindingPlanningBoardResourceCapacity,
  updateGrindingPlanningBoardResourceCapacity
} from '../grinding-planning-board-resource-capacity.service.js';
import { isUnitSplitEnabled } from '../sessaku-pieces/unit-split-policy.js';

const siteKey = 'site-a';
const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, resourceCd: '305' };

describe('grinding planning board resource capacity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    capacity.findMany.mockResolvedValue([]);
  });

  it('returns an empty map when no overrides are stored', async () => {
    expect(await getGrindingPlanningBoardResourceCapacity({ siteKey })).toMatchObject({ runsThroughBreaksResources: [], dailyHoursByResource: {} });
  });

  it('reads only the site and dashboard and filters default or invalid values', async () => {
    capacity.findMany.mockResolvedValue([
      { resourceCd: '305', dailyHours: 10 },
      { resourceCd: '306', dailyHours: 24 },
      { resourceCd: '307', dailyHours: 8 },
      { resourceCd: '308', dailyHours: 12 }
    ]);
    expect(await getGrindingPlanningBoardResourceCapacity({ siteKey })).toMatchObject({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': 10, '306': 24 } });
    expect(capacity.findMany).toHaveBeenCalledWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey },
      select: { resourceCd: true, dailyHours: true, runsThroughBreaks: true, unitSplitEnabled: true }
    });
  });

  it.each([10, 24] as const)('upserts %s hours with a trimmed resource and returns the full map', async (dailyHours) => {
    capacity.findMany.mockResolvedValue([{ resourceCd: '305', dailyHours }, { resourceCd: '306', dailyHours: 24 }]);
    expect(await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: ' 305 ', dailyHours }))
      .toMatchObject({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': dailyHours, '306': 24 } });
    expect(capacity.upsert).toHaveBeenCalledWith({
      where: { csvDashboardId_siteKey_resourceCd: key },
      create: { ...key, dailyHours, runsThroughBreaks: false, unitSplitEnabled: null },
      update: { dailyHours }
    });
    expect(capacity.upsert.mock.invocationCallOrder[0]).toBeLessThan(capacity.findMany.mock.invocationCallOrder[0]);
  });

  it('deletes the scoped override for the default 8 hours and returns other resources', async () => {
    capacity.findMany.mockResolvedValue([{ resourceCd: '306', dailyHours: 24 }]);
    expect(await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: ' 305 ', dailyHours: 8 }))
      .toMatchObject({ runsThroughBreaksResources: [], dailyHoursByResource: { '306': 24 } });
    expect(capacity.deleteMany).toHaveBeenCalledWith({ where: { ...key, dailyHours: 8, runsThroughBreaks: false, OR: [{ unitSplitEnabled: null }, { unitSplitEnabled: false }] } });
    expect(capacity.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(capacity.findMany.mock.invocationCallOrder[0]);
  });

  it.each([
    [{ runsThroughBreaks: true }, { runsThroughBreaks: true }, 8, true],
    [{ runsThroughBreaks: false }, { runsThroughBreaks: false }, 8, false],
    [{ dailyHours: 8 }, { dailyHours: 8 }, 8, false],
    [{ dailyHours: 10, runsThroughBreaks: true }, { dailyHours: 10, runsThroughBreaks: true }, 10, true]
  ] as const)('updates only supplied fields: %j', async (patch, update, dailyHours, runsThroughBreaks) => {
    capacity.findMany.mockResolvedValue([{ resourceCd: '305', dailyHours: 8, runsThroughBreaks: true }]);
    expect(await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '305', ...patch }))
      .toMatchObject({ dailyHoursByResource: {}, runsThroughBreaksResources: ['305'] });
    expect(capacity.upsert).toHaveBeenCalledWith({ where: { csvDashboardId_siteKey_resourceCd: key },
      create: { ...key, dailyHours, runsThroughBreaks, unitSplitEnabled: null }, update });
    expect(capacity.deleteMany).toHaveBeenCalledWith({ where: { ...key, dailyHours: 8, runsThroughBreaks: false, OR: [{ unitSplitEnabled: null }, { unitSplitEnabled: false }] } });
  });
  it('retains either non-default setting across partial updates and deletes only both defaults', async () => {
    let row: { resourceCd: string; dailyHours: number; runsThroughBreaks: boolean } | null = null;
    capacity.upsert.mockImplementation(async ({ create, update }) => { row = row ? { ...row, ...update } : create; });
    capacity.deleteMany.mockImplementation(async ({ where }) => {
      if (row?.dailyHours === where.dailyHours && row?.runsThroughBreaks === where.runsThroughBreaks) row = null;
    });
    capacity.findMany.mockImplementation(async () => row ? [row] : []);
    const update = (patch: { dailyHours?: 8 | 10; runsThroughBreaks?: boolean }) => updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '305', ...patch });
    expect(await update({ runsThroughBreaks: true })).toMatchObject({ dailyHoursByResource: {}, runsThroughBreaksResources: ['305'] });
    expect(await update({ dailyHours: 10 })).toMatchObject({ dailyHoursByResource: { '305': 10 }, runsThroughBreaksResources: ['305'] });
    expect(await update({ runsThroughBreaks: false })).toMatchObject({ dailyHoursByResource: { '305': 10 }, runsThroughBreaksResources: [] });
    expect(await update({ runsThroughBreaks: true })).toMatchObject({ dailyHoursByResource: { '305': 10 }, runsThroughBreaksResources: ['305'] });
    expect(await update({ dailyHours: 8 })).toMatchObject({ dailyHoursByResource: {}, runsThroughBreaksResources: ['305'] });
    expect(await update({ runsThroughBreaks: false })).toMatchObject({ dailyHoursByResource: {}, runsThroughBreaksResources: [] });
    expect(row).toBeNull();
  });
  it('rejects an empty patch', async () => {
    await expect(updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '305' })).rejects.toMatchObject({ statusCode: 400 });
    expect(capacity.upsert).not.toHaveBeenCalled();
  });
  it.each(['', '   ', 'x'.repeat(21)])('rejects invalid resource code %j before persistence', async (resourceCd) => {
    await expect(updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd, dailyHours: 10 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(capacity.upsert).not.toHaveBeenCalled();
    expect(capacity.deleteMany).not.toHaveBeenCalled();
    expect(capacity.findMany).not.toHaveBeenCalled();
  });

  it('accepts a 20-character resource code', async () => {
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: 'x'.repeat(20), dailyHours: 10 });
    expect(capacity.upsert).toHaveBeenCalled();
  });

  it('rejects invalid hours at runtime before persistence', async () => {
    // @ts-expect-error exercise an untyped caller
    await expect(updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '305', dailyHours: 12 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(capacity.upsert).not.toHaveBeenCalled();
    expect(capacity.deleteMany).not.toHaveBeenCalled();
  });
  it('resolves absent and null settings with 021/022 ON and others OFF', async () => {
    capacity.findMany.mockResolvedValue([
      { resourceCd: '021', dailyHours: 8, unitSplitEnabled: null },
      { resourceCd: '022', dailyHours: 8, unitSplitEnabled: false },
      { resourceCd: '305', dailyHours: 8, unitSplitEnabled: null },
      { resourceCd: '306', dailyHours: 8, unitSplitEnabled: true }
    ]);
    const result = await getGrindingPlanningBoardResourceCapacity({ siteKey });
    expect(result.unitSplitEnabledByResource).toEqual({ '021': true, '022': false, '305': false, '306': true });
    expect(isUnitSplitEnabled('021')).toBe(true);
    expect(isUnitSplitEnabled('022')).toBe(true);
    expect(isUnitSplitEnabled('999', result)).toBe(false);
  });
  it.each([
    ['021', false, false], ['022', false, false], ['305', true, true],
    ['021', true, null], ['305', false, null], ['021', null, null]
  ] as const)('stores/reset unit split for %s = %s', async (resourceCd, unitSplitEnabled, stored) => {
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd, unitSplitEnabled });
    expect(capacity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ unitSplitEnabled: stored }), update: { unitSplitEnabled: stored }
    }));
    expect(capacity.deleteMany).toHaveBeenCalledWith({ where: {
      csvDashboardId: key.csvDashboardId, siteKey, resourceCd, dailyHours: 8, runsThroughBreaks: false,
      OR: [{ unitSplitEnabled: null }, { unitSplitEnabled: resourceCd === '021' || resourceCd === '022' }]
    } });
  });
  it('keeps a non-default unit split setting across partial updates', async () => {
    let row: Record<string, unknown> | null = null;
    capacity.upsert.mockImplementation(async ({ create, update }) => { row = row ? { ...row, ...update } : create; });
    capacity.deleteMany.mockImplementation(async ({ where }) => {
      if (row?.dailyHours === where.dailyHours && row?.runsThroughBreaks === where.runsThroughBreaks
        && where.OR.some((condition: { unitSplitEnabled: boolean | null }) => condition.unitSplitEnabled === row?.unitSplitEnabled)) row = null;
    });
    capacity.findMany.mockImplementation(async () => row ? [row] : []);
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '021', unitSplitEnabled: false });
    expect(row).not.toBeNull();
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '021', dailyHours: 8 });
    expect(row).toMatchObject({ unitSplitEnabled: false });
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: '021', unitSplitEnabled: null });
    expect(row).toBeNull();
  });

  it('retains the existing resource-code input contract and handles unset dictionary keys', async () => {
    await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: 'G/01.切削', dailyHours: 10 });
    expect(capacity.upsert).toHaveBeenCalled();
    const result = await getGrindingPlanningBoardResourceCapacity({ siteKey });
    for (const cd of ['constructor', 'toString', '__proto__']) expect(isUnitSplitEnabled(cd, result)).toBe(false);
  });

});
