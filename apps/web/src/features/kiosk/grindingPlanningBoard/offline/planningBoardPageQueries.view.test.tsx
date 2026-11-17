import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { api } from '../../../../api/client';
import { productionFixture } from '../__perf__/fixture';
import { usePlanningBoardPageItems } from '../usePlanningBoardPageItems';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { PlanningBoardOfflineContextProvider, usePlanningBoardOffline } from './planningBoardOfflineContext';
import { usePlanningBoardPageQueries } from './planningBoardOfflineQueries';

import type { GrindingPlanningBoardView } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

vi.mock('../../../../api/hooks', async original => ({
  ...await original<typeof import('../../../../api/hooks')>(),
  useKioskGrindingPlanningBoardLoad: () => ({}),
  useKioskProductionScheduleResources: () => ({}),
  useKioskGrindingPlanningBoardSeibanCandidates: () => ({}),
  useKioskGrindingPlanningBoardDueDetail: () => ({})
}));
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('shares the complete paged board across view switches, preserving local sorting and refresh (offline=%s)', async enabled => {
  const fixture = productionFixture(2, 1);
  const items = fixture.items.map((item, i) => ({ ...item, fseiban: 'S1', processOrder: String(20 - i * 10),
    originalDueDate: '2026-11-12', effectiveDueDate: '2026-11-12', originalRank: null, alternateRank: null,
    specialDue: null, isCompleted: false }));
  const page = (cursor?: number) => ({
    siteKey: 'test', category: 'grinding', view: 'resource', sourceRevision: 'same', boardVersion: 1,
    registeredFseibans: ['S1'], seibanOrder: ['S1'], resources: ['021'], load: [], seibanProgress: {},
    unknownRequiredMinutesCount: 0, items: [items[cursor ? 1 : 0]], snapshotId: 'snapshot', nextCursor: cursor ? null : '1'
  });
  const get = vi.spyOn(api, 'get').mockImplementation(async (path, config) => ({ status: 200, headers: {},
    data: path.endsWith('/grinding-planning-board') ? page(config?.params?.cursor)
      : path.endsWith('/load') ? { load: [] } : { resources: [], candidates: [], dailyHoursByResource: {}, runsThroughBreaksResources: [] }
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const offlineConfig = { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled };
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    <PlanningBoardOfflineContextProvider config={offlineConfig}>{children}</PlanningBoardOfflineContextProvider>
  </QueryClientProvider>;
  const hook = renderHook(({ view }: { view: GrindingPlanningBoardView }) => {
    const { boardQuery } = usePlanningBoardPageQueries({ category: 'grinding', view, includePieces: true, completionFilter: 'incomplete' },
      { refetchIntervalMs: false, drawerOpen: false, showCompletedCandidates: false, dueDetailFseiban: null });
    const sorted = usePlanningBoardPageItems({ displayItems: boardQuery.data?.items ?? [], registeredFseibans: ['S1'], view,
      allocation: 'alternate', data: boardQuery.data, activeFseibans: new Set(['S1']), selectedItemIdsByCategory: {}, category: 'grinding' });
    return { boardQuery, sorted, phase: usePlanningBoardOffline().snapshot.phase };
  }, { wrapper, initialProps: { view: 'resource' as GrindingPlanningBoardView } });
  await waitFor(() => expect(hook.result.current.boardQuery.isComplete).toBe(true));
  await waitFor(() => expect(hook.result.current.phase).toBe('online'));
  const boardCalls = () => get.mock.calls.filter(([path]) => path.endsWith('/grinding-planning-board'));
  expect(boardCalls()).toHaveLength(2);
  const sharedItems = hook.result.current.boardQuery.data!.items;
  for (const view of ['seiban', 'resource', 'seiban'] as const) {
    hook.rerender({ view });
    await waitFor(() => expect(hook.result.current.boardQuery.data?.view).toBe(view));
    expect(hook.result.current.boardQuery.data?.items).toBe(sharedItems);
    expect(hook.result.current.boardQuery.scopeReady).toBe(true);
    expect(hook.result.current.boardQuery.hasStableData).toBe(true);
    expect(hook.result.current.sorted.sortedItemsBySeiban.get('S1')?.map(item => item.processOrder)).toEqual(['10', '20']);
    expect(boardCalls()).toHaveLength(2);
  }
  await hook.result.current.boardQuery.refetch();
  await waitFor(() => expect(boardCalls()).toHaveLength(4));
  hook.unmount(); client.clear();
});
