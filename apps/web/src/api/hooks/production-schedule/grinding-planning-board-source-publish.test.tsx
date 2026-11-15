import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { usePlanningBoardQueryData } from '../../../features/kiosk/grindingPlanningBoard/usePlanningBoardQueryData';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import { useConfigureKioskSessakuPieceOps, useKioskGrindingPlanningBoardLoad, useKioskGrindingPlanningBoardProgressive } from './grinding-planning-board';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ board: vi.fn(), load: vi.fn(), configure: vi.fn() }));
vi.mock('../../client', async (original) => ({ ...await original<typeof import('../../client')>(), getKioskGrindingPlanningBoard: mocks.board, getKioskGrindingPlanningBoardLoad: mocks.load }));
vi.mock('../../domains/production-schedule/grinding-planning-board', () => ({ configureKioskSessakuPieceOps: mocks.configure }));
const params = { category: 'cutting', view: 'resource', scheduleSource: 'dCompany' } as const;
function item(id: string, minutes: number): GrindingPlanningBoardItem {
  return {
    itemId: id, kind: 'row', itemRevision: 'same-row-revision', version: 1, sourceRowId: id,
    fseiban: '26-1', fhincd: id, fhinmei: id, machineName: null, productNo: '1', processOrder: '10',
    originalResourceCd: '021', effectiveResourceCd: null, originalDueDate: '2026-11-12', effectiveDueDate: null,
    originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: minutes,
    requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
    progress: { completed: 0, total: 1, quantityKnown: true }
  };
}
function page(id: string, minutes: number, nextCursor: string | null, snapshotId = 'same-snapshot'): GrindingPlanningBoardResponse {
  return {
    siteKey: 'test', category: 'cutting', view: 'resource', sourceRevision: 'same-board-revision', boardVersion: 1,
    registeredFseibans: ['26-1'], seibanOrder: ['26-1'], resources: ['021'], items: [item(id, minutes)],
    load: [], unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId, nextCursor
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1); for (let i = 0; i < 30; i++) await Promise.resolve(); });
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
  const hook = renderHook(() => {
    const board = useKioskGrindingPlanningBoardProgressive(params, { refetchIntervalMs: false });
    return { ...board, data: usePlanningBoardQueryData(board.data) };
  }, { wrapper: Wrapper });
  return { hook, client };
}
beforeEach(() => { vi.useFakeTimers(); mocks.board.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

it('publishes changed tail items with identical first-page JSON, snapshotId, sourceRevision and paramsKey', async () => {
  let minutes = 120;
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => Promise.resolve(cursor ? page('b', minutes, null) : page('a', 60, '160')));
  const { hook, client } = setup();
  await flush();
  const firstPage = client.getQueryData(productionScheduleQueryKeys.grindingPlanningBoard(params));
  const previous = hook.result.current.data;
  expect(previous?.items.map(({ requiredMinutes }) => requiredMinutes)).toEqual([60, 120]);
  minutes = 60;
  await act(async () => { await client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }); });
  await flush();
  // TanStack structural sharing really kept the identical first-page object.
  expect(client.getQueryData(productionScheduleQueryKeys.grindingPlanningBoard(params))).toBe(firstPage);
  expect(hook.result.current.data).not.toBe(previous);
  expect(hook.result.current.data?.items.map(({ requiredMinutes }) => requiredMinutes)).toEqual([60, 60]);
  expect(hook.result.current.isComplete).toBe(true);
  hook.unmount(); client.clear();
});

it('keeps the complete display while refreshing and rejects an older continuation that finishes last', async () => {
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => Promise.resolve(cursor ? page('b', 120, null, 'initial') : page('a', 120, '160', 'initial')));
  const { hook, client } = setup();
  await flush();
  const previous = hook.result.current.data;
  const oldTail = deferred<GrindingPlanningBoardResponse>();
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => cursor ? oldTail.promise : Promise.resolve(page('a', 120, '160', 'older')));
  await act(async () => { await client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }); });
  await flush();
  expect(hook.result.current.data).toBe(previous);
  expect(mocks.board.mock.calls.some(([query]) => query.snapshotId === 'older')).toBe(true);
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => Promise.resolve(cursor ? page('b', 60, null, 'newer') : page('a', 60, '160', 'newer')));
  await act(async () => { await client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }); });
  await flush();
  expect(hook.result.current.data?.snapshotId).toBe('newer');
  const replacement = hook.result.current.data;
  await act(async () => { oldTail.resolve(page('b', 120, null, 'older')); });
  await flush();
  expect(hook.result.current.data).toBe(replacement);
  expect(hook.result.current.data?.items.map(({ requiredMinutes }) => requiredMinutes)).toEqual([60, 60]);
  expect(hook.result.current.appendError).toBeNull();
  hook.unmount(); client.clear();
});

it('defers load exactly once until every page settles, suppressing revision-driven invalidation', async () => {
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => Promise.resolve(cursor ? page('b', 120, null) : page('a', 60, '160')));
  mocks.load.mockResolvedValue({ load: [] });
  mocks.configure.mockResolvedValue({ pieces: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
  const hook = renderHook(() => {
    const board = useKioskGrindingPlanningBoardProgressive(params, { refetchIntervalMs: false });
    const load = useKioskGrindingPlanningBoardLoad('cutting', 'dCompany');
    const configure = useConfigureKioskSessakuPieceOps(undefined, {
      refreshBoard: () => board.refetch({ loadAlreadyInvalidated: true })
    });
    return { board, load, configure };
  }, { wrapper: Wrapper });
  await flush();
  expect(hook.result.current.board.isComplete).toBe(true);
  expect(mocks.load).toHaveBeenCalledTimes(1);
  const tail = deferred<GrindingPlanningBoardResponse>();
  mocks.board.mockImplementation(({ cursor }: { cursor?: number }) => cursor ? tail.promise
    : Promise.resolve({ ...page('a', 10, '160', 'configured'), sourceRevision: 'configured-revision' }));
  let settled = false;
  act(() => { void hook.result.current.configure.mutateAsync({ itemId: 'piece:a', itemRevision: 'r',
    expectedPieceSetVersion: 1, resourceCd: '021', minutes: [10, 20] }).then(() => { settled = true; }); });
  await flush();
  expect(mocks.board).toHaveBeenCalledTimes(4); // Initial head/tail and refreshing head/tail.
  expect(hook.result.current.configure.isPending).toBe(true);
  expect(hook.result.current.board.data?.snapshotId).toBe('same-snapshot');
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  await act(async () => { tail.resolve({ ...page('b', 20, null, 'configured'), sourceRevision: 'configured-revision' }); });
  await flush();
  expect(hook.result.current.board.data?.snapshotId).toBe('configured');
  expect(hook.result.current.board.data?.items.map(({ requiredMinutes }) => requiredMinutes)).toEqual([10, 20]);
  expect(settled).toBe(true);
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey === productionScheduleQueryKeys.grindingPlanningBoardLoadAll)).toHaveLength(0);
  hook.unmount(); client.clear();
});

it.each([
  ['own saved revision', 'saved', 0],
  ['another change on top of the saved revision', 'external', 1]
] as const)('load-neutral reconciliation keeps load only for its %s', async (_label, refetched, expected) => {
  let revision = 'before';
  mocks.board.mockImplementation(() => Promise.resolve({ ...page('a', 60, null), sourceRevision: revision }));
  const { hook, client } = setup();
  await flush();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  revision = refetched;
  let complete!: Promise<unknown>;
  act(() => { complete = hook.result.current.refetch({ loadUnaffectedRevision: 'saved' }); });
  await flush();
  await act(async () => { await complete; });
  expect(invalidate.mock.calls.filter(([query]) => JSON.stringify(query?.queryKey) === JSON.stringify(productionScheduleQueryKeys.grindingPlanningBoardLoadAll))).toHaveLength(expected);
  hook.unmount(); client.clear();
});

it.each([false, true])('suppresses revision-triggered load invalidation on write reconciliation (affects load: %s)', async (affectsLoad) => {
  let revision = 'before';
  mocks.board.mockImplementation(() => Promise.resolve({ ...page('a', 60, null), sourceRevision: revision }));
  const { hook, client } = setup();
  await flush();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  revision = 'after';
  let complete!: Promise<unknown>;
  act(() => { complete = hook.result.current.refetch({ loadAlreadyInvalidated: true });
    if (affectsLoad) void client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardLoadAll }, { cancelRefetch: false }); });
  await flush();
  await act(async () => { await complete; });
  expect(invalidate.mock.calls.filter(([query]) => JSON.stringify(query?.queryKey) === JSON.stringify(productionScheduleQueryKeys.grindingPlanningBoardLoadAll))).toHaveLength(affectsLoad ? 1 : 0);
  // An unrelated future board revision must continue to refresh load.
  revision = 'external';
  await act(async () => { await client.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll }); });
  await flush();
  expect(invalidate.mock.calls.filter(([query]) => JSON.stringify(query?.queryKey) === JSON.stringify(productionScheduleQueryKeys.grindingPlanningBoardLoadAll))).toHaveLength(affectsLoad ? 2 : 1);
  hook.unmount(); client.clear();
});
