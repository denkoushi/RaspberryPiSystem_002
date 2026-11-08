import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../queryKeys/productionSchedule';


const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock('../http', () => ({ api: { get, post, put, delete: remove } }));

import { updateKioskGrindingPlanningBoardFirstProcessArrival, splitKioskSessakuPieces, mergeKioskSessakuPieces, setKioskSessakuPieceCompletion, updateKioskGrindingPlanningBoardArrival, getKioskGrindingPlanningBoard, getKioskGrindingPlanningBoardLoad, getKioskGrindingPlanningBoardProcessChips, getKioskGrindingPlanningBoardSnapshot } from './production-schedule';

describe('grinding planning board requests', () => {
  it('separates board and snapshot piece requests while keeping one load cache key', () => {
    const params = { category: 'cutting' as const, view: 'resource' as const };
    expect(productionScheduleQueryKeys.grindingPlanningBoard(params)).not.toEqual(productionScheduleQueryKeys.grindingPlanningBoard({ ...params, includePieces: true }));
    expect(productionScheduleQueryKeys.grindingPlanningBoardSnapshot(params)).not.toEqual(productionScheduleQueryKeys.grindingPlanningBoardSnapshot({ ...params, includePieces: true }));
    expect(productionScheduleQueryKeys.grindingPlanningBoardLoad('cutting')).toEqual(['kiosk-grinding-planning-board', 'load', 'cutting']);
  });
  it('preserves includePieces through snapshot continuation', async () => {
    get.mockResolvedValueOnce({ data: { items: [], sourceRevision: 'r', snapshotId: 's', nextCursor: '1' } })
      .mockResolvedValueOnce({ data: { items: [], sourceRevision: 'r', snapshotId: 's', nextCursor: null } });
    await getKioskGrindingPlanningBoardSnapshot({ category: 'cutting', view: 'resource', includePieces: true });
    expect(get).toHaveBeenCalledTimes(2);
    for (const [, config] of get.mock.calls) expect(config.params.includePieces).toBe(true);
  });
  it('keeps piece reads and mutations explicit without changing old requests', async () => {
    get.mockResolvedValue({ data: { items: [], sourceRevision: 'r', nextCursor: null } });
    await getKioskGrindingPlanningBoard({ category: 'cutting', view: 'resource', includePieces: true });
    expect(get).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board', expect.objectContaining({ params: expect.objectContaining({ includePieces: true }) }));
    await getKioskGrindingPlanningBoardLoad('cutting');
    expect(get).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board/load', { params: { category: 'cutting' } });
    post.mockResolvedValue({ data: {} }); put.mockResolvedValue({ data: {} });
    const split = { parentItemId: 'row:parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' };
    await splitKioskSessakuPieces(split); expect(post).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board/pieces/split', split);
    const merge = { parentItemId: 'row:parent', pieceIds: ['a', 'b'], expectedPieceSetVersion: 1, itemRevisions: { 'piece:a': 'a', 'piece:b': 'b' } };
    await mergeKioskSessakuPieces(merge); expect(post).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board/pieces/merge', merge);
    const completion = { intent: 'incomplete' as const, expectedPieceSetVersion: 2, itemRevision: 'r2' };
    await setKioskSessakuPieceCompletion('a', completion); expect(put).toHaveBeenLastCalledWith('/kiosk/production-schedule/grinding-planning-board/pieces/a/completion', completion);
  });
  it.each(['excel', 'scaw'] as const)('sends dueSource=%s on all snapshot pages', async (dueSource) => {
    get.mockResolvedValue({ data: { items: [], sourceRevision: 'r', nextCursor: null } });
    await getKioskGrindingPlanningBoardSnapshot({ category: 'grinding', view: 'seiban', dueSource });
    expect(get).toHaveBeenCalledWith('/kiosk/production-schedule/grinding-planning-board', expect.objectContaining({ params: expect.objectContaining({ dueSource }) }));
  });
  beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); remove.mockReset(); });

  it.each([true, false])('sends arrival recorded=%s with the item revision', async (recorded) => {
    const body = { itemId: 'row:a', itemRevision: 'r1', overrideVersion: 2 };
    const data = { itemId: body.itemId, manualArrivalDate: recorded ? '2026-11-06' : null };
    (recorded ? put : remove).mockResolvedValue({ data });
    await expect(updateKioskGrindingPlanningBoardArrival({ ...body, recorded })).resolves.toEqual(data);
    const url = '/kiosk/production-schedule/grinding-planning-board/arrival';
    if (recorded) expect(put).toHaveBeenCalledExactlyOnceWith(url, body);
    else expect(remove).toHaveBeenCalledExactlyOnceWith(url, { data: body });
  });

  it.each(['arrived', 'excluded', null] as const)('sends first-process state %s with the item revision', async (state) => {
    const body = { itemId: 'row:a', itemRevision: 'r1', overrideVersion: 2, state };
    const data = { itemId: body.itemId, firstProcessState: state };
    put.mockResolvedValue({ data });
    await expect(updateKioskGrindingPlanningBoardFirstProcessArrival(body)).resolves.toEqual(data);
    expect(put).toHaveBeenCalledExactlyOnceWith('/kiosk/production-schedule/grinding-planning-board/first-process-arrival', body);
  });

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
