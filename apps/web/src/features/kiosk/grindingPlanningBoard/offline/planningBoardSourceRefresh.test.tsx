import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../../../../api/queryKeys/productionSchedule';
import { usePlanningBoardGantt } from '../gantt/usePlanningBoardGantt';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';
import { useOfflineBoard, useOfflineLoad } from './planningBoardOfflineQueries';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse, GrindingPlanningBoardResourceMinutesSourceRequest } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../../../api/client', async (original) => ({
  ...await original<typeof import('../../../../api/client')>(),
  api: { get: mocks.get }, getResolvedClientKey: () => 'test-terminal',
  updateKioskGrindingPlanningBoardResourceMinutesSource: mocks.save
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function item(id: string, source: 'original' | 'own'): GrindingPlanningBoardItem {
  return {
    itemId: id, kind: 'row', itemRevision: 'unchanged-row', version: 1, sourceRowId: id,
    fseiban: '26-1', fhincd: id, fhinmei: id, machineName: null, productNo: '1', processOrder: '10',
    originalResourceCd: id === 'b' ? '022' : '021', effectiveResourceCd: null,
    originalDueDate: '2026-11-12', effectiveDueDate: null, originalRank: null, alternateRank: null,
    plannedQuantity: 1, originalRequiredMinutes: 60, ownRequiredMinutes: 120,
    requiredMinutesSource: source, requiredMinutes: source === 'own' ? 120 : 60,
    requiredMinutesKnown: true, isCompleted: false, lslhSurface: false,
    progress: { completed: 0, total: 1, quantityKnown: true }
  };
}
function page(source: 'original' | 'own', snapshotId: string, cursor: number): GrindingPlanningBoardResponse {
  return {
    siteKey: 'test', category: 'cutting', view: 'resource', sourceRevision: 'unchanged-board-revision', boardVersion: 1,
    registeredFseibans: ['26-1'], seibanOrder: ['26-1'], resources: ['021', '022'],
    items: [item(cursor === 0 ? 'a' : cursor === 160 ? 'b' : 'c', source)], load: [],
    unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId,
    nextCursor: cursor === 0 ? '160' : cursor === 160 ? '800' : null
  };
}
const config = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true };
const params = { category: 'cutting', view: 'resource', scheduleSource: 'dCompany', includePieces: true } as const;
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); window.localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

// Real provider, offline reads, Gantt source-change callback and scoped mutation.
// Only the HTTP boundary is mocked; completion order is controlled explicitly.
it.each([
  ['own', 'original', 0], ['original', 'own', 0],
  ['own', 'original', 1], ['own', 'original', 2]
] as const)('refreshes once after both saves with a changed settings Date: %s -> %s, failing save=%s', async (from, to, failingSave) => {
  let switching = false;
  let own = from === 'own' ? ['021', '022'] : [];
  const initialDate = 'Wed, 11 Nov 2026 06:25:41 GMT';
  const nextDate = 'Wed, 11 Nov 2026 06:25:42 GMT';
  const firstPages: Array<ReturnType<typeof deferred<unknown>>> = [];
  const loads: Array<ReturnType<typeof deferred<unknown>>> = [];
  const calls: Array<{ path: string; cursor?: number; signal?: AbortSignal }> = [];
  const reply = (data: unknown, date = switching ? nextDate : initialDate) => ({ status: 200, headers: { date }, data });
  mocks.get.mockImplementation((path: string, options: { params?: { cursor?: number; snapshotId?: string }; signal?: AbortSignal }) => {
    calls.push({ path, cursor: options.params?.cursor, signal: options.signal });
    if (path.endsWith('/resource-capacity')) return Promise.resolve(reply({ dailyHoursByResource: {}, runsThroughBreaksResources: [] }));
    if (path.endsWith('/resource-minutes')) return Promise.resolve(reply({ ownSourceResourceCds: [...own], values: [] }));
    if (path.endsWith('/load')) {
      if (!switching) return Promise.resolve(reply({ load: [] }));
      const load = deferred<unknown>(); loads.push(load); return load.promise;
    }
    const cursor = options.params?.cursor ?? 0;
    if (switching && cursor === 0) {
      const first = deferred<unknown>(); firstPages.push(first); return first.promise;
    }
    return Promise.resolve(reply(page(switching ? to : from, options.params?.snapshotId ?? 'initial', cursor)));
  });
  mocks.save.mockImplementation(async ({ resourceCd, source }: GrindingPlanningBoardResourceMinutesSourceRequest) => {
    expect(firstPages).toHaveLength(0);
    expect(loads).toHaveLength(0);
    if (failingSave === mocks.save.mock.calls.length) throw new Error('save failed');
    own = [...own.filter((cd) => cd !== resourceCd), ...(source === 'own' ? [resourceCd] : [])];
    return { ownSourceResourceCds: [...own], values: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><PlanningBoardOfflineProvider config={config}>{children}</PlanningBoardOfflineProvider></QueryClientProvider>;
  }
  const hook = renderHook(() => {
    const board = useOfflineBoard(params);
    useOfflineLoad('cutting', 'dCompany');
    const gantt = usePlanningBoardGantt({ enabled: true, preferenceScope: 'source-refresh', items: board.data?.items ?? [],
      resources: ['021', '022'], seibanOrder: ['26-1'], view: 'resource', allocation: 'alternate',
      today: '2026-11-11', category: 'cutting' });
    return { board, gantt, offline: usePlanningBoardOffline() };
  }, { wrapper: Wrapper });
  await flush();
  expect(hook.result.current.offline.snapshot.phase).toBe('online');
  expect(hook.result.current.board.data?.items[0].requiredMinutesSource).toBe(from);
  const generation = hook.result.current.offline.gate.generation();
  const before = hook.result.current.offline;
  const barMinutes = () => hook.result.current.gantt.layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars.map((bar) =>
    Math.round((bar.segments ?? []).reduce((sum, segment) => sum + segment.end - segment.start, 0) * 1440))));
  expect(barMinutes()).toEqual([from === 'own' ? 120 : 60, from === 'own' ? 120 : 60, from === 'own' ? 120 : 60]);
  calls.length = 0;
  switching = true;
  act(() => {
    hook.result.current.gantt.changeMinutesSource([{ resourceCd: '021', source: to }, { resourceCd: '022', source: to }]);
  });
  await flush();
  if (failingSave) {
    expect(mocks.save).toHaveBeenCalledTimes(failingSave);
    expect(firstPages).toHaveLength(0);
    expect(loads).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(hook.result.current.gantt.minutesError).toBe(true);
    hook.unmount(); client.clear();
    return;
  }
  expect(mocks.save.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', source: to }, { resourceCd: '022', source: to }
  ]);
  expect(firstPages).toHaveLength(1);
  expect(loads).toHaveLength(1);
  expect(calls.filter(({ path }) => path.endsWith('/resource-minutes'))).toHaveLength(1);
  expect(invalidate.mock.calls.filter(([filter]) => filter?.queryKey === productionScheduleQueryKeys.grindingPlanningBoardAll)).toHaveLength(2);
  // In this mode the board is local hook state, absent from the query cache.
  expect(client.getQueryCache().findAll({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll })).toHaveLength(0);
  expect(hook.result.current.offline.displayedAt).toBe(Date.parse(nextDate));
  for (const key of ['registerRead', 'stagedRead', 'reportRead', 'publishRead', 'refreshRead', 'subscribeFreeze'] as const) {
    expect(hook.result.current.offline[key]).toBe(before[key]);
  }
  await act(async () => {
    firstPages.forEach((first, i) => first.resolve(reply(page(to, `replacement-${i}`, 0))));
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
  expect(calls.filter(({ cursor }) => cursor === 160)).toHaveLength(1);
  expect(calls.filter(({ cursor }) => cursor === 800)).toHaveLength(1);
  expect(calls.every(({ signal }) => !signal?.aborted)).toBe(true);
  expect(hook.result.current.offline.gate.generation()).toBe(generation);
  expect(hook.result.current.offline.snapshot.phase).toBe('online');
  const immediatelyAfter = hook.result.current.board.data;
  const immediateBarMinutes = barMinutes();
  await act(async () => { loads.forEach((load) => load.resolve(reply({ load: [] }))); });
  expect(hook.result.current.board.data).toBe(immediatelyAfter);
  expect({ sources: immediatelyAfter?.items.map(({ requiredMinutesSource }) => requiredMinutesSource), barMinutes: immediateBarMinutes })
    .toEqual({ sources: [to, to, to], barMinutes: [to === 'own' ? 120 : 60, to === 'own' ? 120 : 60, to === 'own' ? 120 : 60] });
  hook.unmount(); client.clear();
});
