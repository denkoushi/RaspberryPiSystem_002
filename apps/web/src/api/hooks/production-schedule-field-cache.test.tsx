import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLeaderboardBoardCacheMutationBridge } from '../../features/kiosk/leaderOrderBoard/useLeaderboardBoardCacheMutationBridge';
import { productionScheduleQueryKeys } from '../queryKeys/productionSchedule';

import type { KioskProductionScheduleOrderCachePolicy } from './production-schedule/schedule';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ note: vi.fn(), dueDate: vi.fn() }));
vi.mock('../client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../client')>(),
  updateKioskProductionScheduleNote: mocks.note,
  updateKioskProductionScheduleDueDate: mocks.dueDate
}));

const boardKey = productionScheduleQueryKeys.leaderboardBoard({ resourceCds: 'R1' });

describe('note/due-date cache policy through the leaderboard write bridge', () => {
  beforeEach(() => {
    mocks.note.mockReset().mockResolvedValue({ note: 'saved' });
    mocks.dueDate.mockReset().mockResolvedValue({ dueDate: '2026-10-20' });
  });

  it.each([undefined, 'default', 'manualOrderOptimistic', 'leaderBoardFastPath'] as const)(
    '%s keeps field patches and invalidates the board at most once per save',
    async (cachePolicy: KioskProductionScheduleOrderCachePolicy | undefined) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const initial = { page: 1, pageSize: 80, total: 1, resources: [], rows: [{ id: 'row-1', rowData: {}, note: '', dueDate: null }] };
      const getBoard = vi.fn(async () => client.getQueryData<typeof initial>(boardKey) ?? initial);
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const applyDisplayMutation = vi.fn();
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      const hook = renderHook(() => ({
        board: useQuery({ queryKey: boardKey, queryFn: getBoard, staleTime: Infinity }),
        writes: useLeaderboardBoardCacheMutationBridge({
          isSearchStateWriting: false,
          noteMaxLength: 100,
          productionScheduleOrderCachePolicy: cachePolicy
        }, applyDisplayMutation, true)
      }), { wrapper });
      await waitFor(() => expect(hook.result.current.board.isSuccess).toBe(true));
      const noteSettled = vi.fn();
      act(() => hook.result.current.writes.saveNote({ rowId: 'row-1', note: 'saved', onSettled: noteSettled }));
      await waitFor(() => expect(noteSettled).toHaveBeenCalledOnce());
      expect(hook.result.current.board.data?.rows[0]?.note).toBe('saved');
      expect(applyDisplayMutation).toHaveBeenCalledWith({ kind: 'note', rowId: 'row-1', note: 'saved' });
      const expectedInvalidations = cachePolicy === 'leaderBoardFastPath' ? 0 : 1;
      expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey === productionScheduleQueryKeys.scheduleAll)).toHaveLength(expectedInvalidations);
      expect(getBoard).toHaveBeenCalledTimes(1 + expectedInvalidations);

      invalidate.mockClear();
      const dueDateSettled = vi.fn();
      act(() => hook.result.current.writes.commitDueDate({ rowId: 'row-1', dueDate: '2026-10-20', onSettled: dueDateSettled }));
      await waitFor(() => expect(dueDateSettled).toHaveBeenCalledOnce());
      expect(hook.result.current.board.data?.rows[0]?.dueDate).toBe('2026-10-20');
      expect(applyDisplayMutation).toHaveBeenCalledWith({ kind: 'dueDate', rowId: 'row-1', dueDate: '2026-10-20' });
      expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey === productionScheduleQueryKeys.scheduleAll)).toHaveLength(expectedInvalidations);
      expect(getBoard).toHaveBeenCalledTimes(1 + 2 * expectedInvalidations);
      hook.unmount();
      client.clear();
    }
  );
});
