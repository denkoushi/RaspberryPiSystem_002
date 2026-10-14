import { beforeEach, describe, expect, it, vi } from 'vitest';

const capacity = vi.hoisted(() => ({ findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleGrindingPlanningBoardResourceCapacity: capacity } }));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  getGrindingPlanningBoardResourceCapacity,
  updateGrindingPlanningBoardResourceCapacity
} from '../grinding-planning-board-resource-capacity.service.js';

const siteKey = 'site-a';
const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, resourceCd: '305' };

describe('grinding planning board resource capacity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    capacity.findMany.mockResolvedValue([]);
  });

  it('returns an empty map when no overrides are stored', async () => {
    expect(await getGrindingPlanningBoardResourceCapacity({ siteKey })).toEqual({ dailyHoursByResource: {} });
  });

  it('reads only the site and dashboard and filters default or invalid values', async () => {
    capacity.findMany.mockResolvedValue([
      { resourceCd: '305', dailyHours: 10 },
      { resourceCd: '306', dailyHours: 24 },
      { resourceCd: '307', dailyHours: 8 },
      { resourceCd: '308', dailyHours: 12 }
    ]);
    expect(await getGrindingPlanningBoardResourceCapacity({ siteKey })).toEqual({ dailyHoursByResource: { '305': 10, '306': 24 } });
    expect(capacity.findMany).toHaveBeenCalledWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey },
      select: { resourceCd: true, dailyHours: true }
    });
  });

  it.each([10, 24] as const)('upserts %s hours with a trimmed resource and returns the full map', async (dailyHours) => {
    capacity.findMany.mockResolvedValue([{ resourceCd: '305', dailyHours }, { resourceCd: '306', dailyHours: 24 }]);
    expect(await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: ' 305 ', dailyHours }))
      .toEqual({ dailyHoursByResource: { '305': dailyHours, '306': 24 } });
    expect(capacity.upsert).toHaveBeenCalledWith({
      where: { csvDashboardId_siteKey_resourceCd: key },
      create: { ...key, dailyHours },
      update: { dailyHours }
    });
    expect(capacity.deleteMany).not.toHaveBeenCalled();
    expect(capacity.upsert.mock.invocationCallOrder[0]).toBeLessThan(capacity.findMany.mock.invocationCallOrder[0]);
  });

  it('deletes the scoped override for the default 8 hours and returns other resources', async () => {
    capacity.findMany.mockResolvedValue([{ resourceCd: '306', dailyHours: 24 }]);
    expect(await updateGrindingPlanningBoardResourceCapacity({ siteKey, resourceCd: ' 305 ', dailyHours: 8 }))
      .toEqual({ dailyHoursByResource: { '306': 24 } });
    expect(capacity.deleteMany).toHaveBeenCalledWith({ where: key });
    expect(capacity.upsert).not.toHaveBeenCalled();
    expect(capacity.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(capacity.findMany.mock.invocationCallOrder[0]);
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
});
