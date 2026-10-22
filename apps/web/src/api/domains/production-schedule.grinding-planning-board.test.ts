import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('../http', () => ({ api: { get, post } }));

import { getKioskGrindingPlanningBoard, getKioskGrindingPlanningBoardLoad, getKioskGrindingPlanningBoardProcessChips, getKioskGrindingPlanningBoardSnapshot } from './production-schedule';

describe('grinding planning board requests', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it('chunks chip requests at 1000 parts and merges their maps', async () => {
    const parts = Array.from({ length: 1001 }, (_, i) => ({ fseiban: `ORDER-${i}`, productNo: '', fhincd: 'PART' }));
    const first = { ['ORDER-0\0\0PART']: [{ rowId: 'a', resourceCd: '305', isCompleted: true }] };
    const second = { ['ORDER-1000\0\0PART']: [{ rowId: 'b', resourceCd: '306', isCompleted: false }] };
    post.mockResolvedValueOnce({ data: { chipsByPartKey: first } }).mockResolvedValueOnce({ data: { chipsByPartKey: second } });
    await expect(getKioskGrindingPlanningBoardProcessChips({ parts })).resolves.toEqual({ chipsByPartKey: { ...first, ...second } });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, '/kiosk/production-schedule/grinding-planning-board/process-chips', { parts: parts.slice(0, 1000) });
    expect(post).toHaveBeenNthCalledWith(2, '/kiosk/production-schedule/grinding-planning-board/process-chips', { parts: parts.slice(1000) });
  });

  it('does not request chips for an empty board', async () => {
    await expect(getKioskGrindingPlanningBoardProcessChips({ parts: [] })).resolves.toEqual({ chipsByPartKey: {} });
    expect(post).not.toHaveBeenCalled();
  });

  it('defers load for every snapshot page', async () => {
    const first = { items: [{ itemId: 'first' }], sourceRevision: 'r1', snapshotId: 's1', nextCursor: '1', load: [], loadDeferred: true };
    const second = { ...first, items: [{ itemId: 'second' }], nextCursor: null };
    get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: second });
    const result = await getKioskGrindingPlanningBoardSnapshot({ category: 'grinding', view: 'seiban', completionFilter: 'incomplete' });
    expect(result.items.map((item) => item.itemId)).toEqual(['first', 'second']);
    expect(get).toHaveBeenNthCalledWith(1, '/kiosk/production-schedule/grinding-planning-board', {
      params: { category: 'grinding', view: 'seiban', completionFilter: 'incomplete', cursor: 0, pageSize: 160, includeLoad: false }
    });
    expect(get).toHaveBeenNthCalledWith(2, '/kiosk/production-schedule/grinding-planning-board', {
      params: { category: 'grinding', view: 'seiban', completionFilter: 'incomplete', cursor: 1, pageSize: 640, snapshotId: 's1', includeLoad: false }
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
