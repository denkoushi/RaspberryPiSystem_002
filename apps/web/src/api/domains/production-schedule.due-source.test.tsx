import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../http', () => ({ api: mocks }));

import { buildLeaderboardBoardContinuePayload } from '../../features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload';
import { buildLeaderboardBoardBaseFetchParams } from '../../features/kiosk/leaderOrderBoard/cache/leaderboardBoardFetchParams';
import { usePersistedLeaderBoardScawMode } from '../../features/kiosk/leaderOrderBoard/usePersistedLeaderBoardScawMode';
import { useKioskGrindingPlanningBoard } from '../hooks/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../queryKeys/productionSchedule';

import { getKioskProductionScheduleLeaderboardBoard, getKioskProductionScheduleLeaderboardShell, getKioskProductionScheduleLeaderboardTotal, postKioskProductionScheduleLeaderboardBoardContinue, postKioskProductionScheduleLeaderboardShellContinue } from './production-schedule';

beforeEach(() => { localStorage.clear(); mocks.get.mockResolvedValue({ data: {} }); mocks.post.mockResolvedValue({ data: {} }); });
afterEach(() => vi.clearAllMocks());

describe('board due source request and cache boundaries', () => {
  it('changes the planning board query key and request when toggled', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender, unmount } = renderHook(({ dueSource }: { dueSource: 'excel' | 'scaw' }) => useKioskGrindingPlanningBoard({ category: 'grinding', view: 'seiban', dueSource }), {
      initialProps: { dueSource: 'excel' as 'excel' | 'scaw' }, wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(expect.anything(), { params: expect.objectContaining({ dueSource: 'excel' }) }));
    rerender({ dueSource: 'scaw' });
    await waitFor(() => expect(mocks.get).toHaveBeenLastCalledWith(expect.anything(), { params: expect.objectContaining({ dueSource: 'scaw' }) }));
    expect(client.getQueryCache().getAll()).toHaveLength(2);
    unmount(); client.clear();
  });

  it('uses the persisted leaderboard toggle for every filter-bearing read phase and cache key', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardScawMode('site', 'device'));
    const read = async () => {
      const dueSource = result.current.scawEnabled ? 'scaw' : 'excel';
      const params = buildLeaderboardBoardBaseFetchParams({ phasedBase: { dueSource }, boardResourceCds: ['305'] });
      const continuation = buildLeaderboardBoardContinuePayload(params, { page: 1, pageSize: 1, total: 1, rows: [], resources: [{ resourceCd: '305', hasMore: true, total: 1, pageSize: 1, snapshotId: `snapshot-${dueSource}`, nextCursor: 1 }] });
      await getKioskProductionScheduleLeaderboardBoard(params);
      await getKioskProductionScheduleLeaderboardShell(params);
      await getKioskProductionScheduleLeaderboardTotal(params);
      await postKioskProductionScheduleLeaderboardBoardContinue(continuation);
      await postKioskProductionScheduleLeaderboardShellContinue({ ...params, snapshotId: `snapshot-${dueSource}`, cursor: 1 });
      for (const call of mocks.get.mock.calls.slice(-3)) expect(call[1].params.dueSource).toBe(dueSource);
      for (const call of mocks.post.mock.calls.slice(-2)) expect(call[1].dueSource).toBe(dueSource);
      return productionScheduleQueryKeys.leaderboardBoard(params);
    };
    const excelKey = await read();
    act(() => result.current.toggleScawMode());
    expect(result.current.scawEnabled).toBe(true);
    const scawKey = await read();
    expect(scawKey).not.toEqual(excelKey);
    act(() => result.current.toggleScawMode());
    expect(await read()).toEqual(excelKey);
  });
});
