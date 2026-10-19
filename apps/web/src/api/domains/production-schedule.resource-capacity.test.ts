import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getKioskGrindingPlanningBoardResourceCapacity, updateKioskGrindingPlanningBoardResourceCapacity } from './production-schedule';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../http', () => ({ api: http }));

describe('resource capacity requests', () => {
  beforeEach(() => vi.resetAllMocks());
  it('専用パスで取得・更新する', async () => {
    const data = { runsThroughBreaksResources: [], dailyHoursByResource: { '305': 10 } };
    http.get.mockResolvedValue({ data });
    http.put.mockResolvedValue({ data });
    await expect(getKioskGrindingPlanningBoardResourceCapacity()).resolves.toEqual(data);
    expect(http.get).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board/resource-capacity');
    await expect(updateKioskGrindingPlanningBoardResourceCapacity({ resourceCd: '305', dailyHours: 10 })).resolves.toEqual(data);
    expect(http.put).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board/resource-capacity', { resourceCd: '305', dailyHours: 10 });
  });
  it('passes a breaks-only patch and the returned resource flags through', async () => {
    const data = { dailyHoursByResource: {}, runsThroughBreaksResources: ['305'] };
    http.put.mockResolvedValue({ data });
    await expect(updateKioskGrindingPlanningBoardResourceCapacity({ resourceCd: '305', runsThroughBreaks: true })).resolves.toEqual(data);
    expect(http.put).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board/resource-capacity', { resourceCd: '305', runsThroughBreaks: true });
  });

});
