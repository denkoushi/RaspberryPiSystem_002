import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('../http', () => ({ api: { get } }));

import { getKioskGrindingPlanningBoard, getKioskGrindingPlanningBoardLoad, getKioskGrindingPlanningBoardSnapshot } from './production-schedule';

describe('grinding planning board requests', () => {
  beforeEach(() => get.mockReset());

  it('defers load for every snapshot page', async () => {
    const first = { items: [{ itemId: 'first' }], sourceRevision: 'r1', snapshotId: 's1', nextCursor: '1', load: [], loadDeferred: true };
    const second = { ...first, items: [{ itemId: 'second' }], nextCursor: null };
    get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: second });
    const result = await getKioskGrindingPlanningBoardSnapshot({ category: 'grinding', view: 'seiban', completionFilter: 'incomplete' });
    expect(result.items.map((item) => item.itemId)).toEqual(['first', 'second']);
    expect(get).toHaveBeenNthCalledWith(1, '/kiosk/production-schedule/grinding-planning-board', {
      params: { category: 'grinding', view: 'seiban', completionFilter: 'incomplete', cursor: 0, includeLoad: false }
    });
    expect(get).toHaveBeenNthCalledWith(2, '/kiosk/production-schedule/grinding-planning-board', {
      params: { category: 'grinding', view: 'seiban', completionFilter: 'incomplete', cursor: 1, snapshotId: 's1', includeLoad: false }
    });
  });

  it('defers load for individual progressive pages and requests load separately', async () => {
    get.mockResolvedValue({ data: { load: [], unknownRequiredMinutesCount: 1 } });
    await getKioskGrindingPlanningBoard({ category: 'cutting', view: 'resource' });
    expect(get).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board', {
      params: { category: 'cutting', view: 'resource', includeLoad: false }
    });
    await expect(getKioskGrindingPlanningBoardLoad('cutting')).resolves.toEqual({ load: [], unknownRequiredMinutesCount: 1 });
    expect(get).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board/load', { params: { category: 'cutting' } });
  });
});
