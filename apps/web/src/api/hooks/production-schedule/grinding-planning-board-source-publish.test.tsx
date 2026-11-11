import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { usePlanningBoardQueryData } from '../../../features/kiosk/grindingPlanningBoard/usePlanningBoardQueryData';
import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import { useKioskGrindingPlanningBoardProgressive } from './grinding-planning-board';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ board: vi.fn() }));
vi.mock('../../client', async (original) => ({ ...await original<typeof import('../../client')>(), getKioskGrindingPlanningBoard: mocks.board }));
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
