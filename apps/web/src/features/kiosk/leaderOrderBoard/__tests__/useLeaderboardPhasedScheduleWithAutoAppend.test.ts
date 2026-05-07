import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLeaderboardPhasedScheduleWithAutoAppend } from '../useLeaderboardPhasedScheduleWithAutoAppend';

import type { ProductionScheduleRow } from '../../../../api/client';

const postContinueMock = vi.fn();

let shellQueryMock: {
  data:
    | {
        page: number;
        pageSize: number;
        total: number;
        rows: ProductionScheduleRow[];
        snapshotId?: string;
        nextCursor?: number;
        hasMore?: boolean;
      }
    | undefined;
  isSuccess: boolean;
  isPlaceholderData: boolean;
  dataUpdatedAt: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
};

let totalQueryMock: {
  data: { total: number };
  isSuccess: boolean;
  isPlaceholderData: boolean;
  dataUpdatedAt: number;
  isError: boolean;
  isFetching: boolean;
};

let decorationsQueryMock: {
  data: {
    rowDecorations: Array<{ id: string; resolvedMachineName?: string | null; customerName?: string | null }>;
    leaderboardFooterChipsByPartKey: Record<string, never>;
  };
  isFetching: boolean;
};

vi.mock('../../../../api/client', () => ({
  postKioskProductionScheduleLeaderboardShellContinue: (...args: unknown[]) => postContinueMock(...args)
}));

vi.mock('../../../../api/hooks', () => ({
  useKioskProductionScheduleLeaderboardShell: () => shellQueryMock,
  useKioskProductionScheduleLeaderboardTotal: () => totalQueryMock,
  useKioskProductionScheduleLeaderboardDecorations: () => decorationsQueryMock
}));

function makeRows(start: number, count: number): ProductionScheduleRow[] {
  return Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return {
      id: `row-${n}`,
      fseiban: `F-${n}`,
      productNo: `P-${n}`,
      productName: `Product ${n}`,
      processName: '研削',
      resourceCd: 'R1',
      rowData: {}
    } as unknown as ProductionScheduleRow;
  });
}

describe('useLeaderboardPhasedScheduleWithAutoAppend', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });

    const shellRows = makeRows(1, 20);
    shellQueryMock = {
      data: {
        page: 1,
        pageSize: 160,
        total: 45,
        rows: shellRows,
        snapshotId: 'snap-test',
        nextCursor: 20,
        hasMore: true
      },
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: 1000,
      isLoading: false,
      isError: false,
      isFetching: false
    };
    totalQueryMock = {
      data: { total: 45 },
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: 1000,
      isError: false,
      isFetching: false
    };
    decorationsQueryMock = {
      data: { rowDecorations: [], leaderboardFooterChipsByPartKey: {} },
      isFetching: false
    };

    postContinueMock.mockReset();
    postContinueMock
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 160,
        rows: makeRows(21, 20),
        snapshotId: 'snap-test',
        nextCursor: 40,
        hasMore: true
      })
      .mockResolvedValueOnce({
        page: 1,
        pageSize: 160,
        rows: makeRows(41, 5),
        snapshotId: 'snap-test',
        nextCursor: 45,
        hasMore: false
      });
  });

  const leaderboardParams: { pageSize: number; allowResourceOnly: boolean } = {
    pageSize: 160,
    allowResourceOnly: true
  };

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  it('同一 shell / total の再レンダーでは continue を連打しない', async () => {
    const { result, rerender } = renderHook(
      () =>
        useLeaderboardPhasedScheduleWithAutoAppend({
          leaderboardPhasedParams: leaderboardParams,
          scheduleEnabled: true,
          pauseRefetch: false,
          refetchIntervalMs: 120000,
          macManualOrderV2: false,
          activeDeviceScopeKey: ''
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(postContinueMock).toHaveBeenCalledTimes(2);
      expect(postContinueMock.mock.calls[0]![0]).toMatchObject({ cursor: 20, snapshotId: 'snap-test' });
      expect(postContinueMock.mock.calls[1]![0]).toMatchObject({ cursor: 40, snapshotId: 'snap-test' });
      expect(result.current.scheduleQuery.data?.rows).toHaveLength(45);
    });

    expect(postContinueMock).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: 'snap-test', cursor: 20, pageSize: 160 })
    );

    shellQueryMock = {
      ...shellQueryMock,
      data: shellQueryMock.data
        ? { ...shellQueryMock.data, rows: [...shellQueryMock.data.rows], snapshotId: 'snap-test', nextCursor: 20, hasMore: true }
        : undefined
    };
    totalQueryMock = {
      ...totalQueryMock,
      data: { total: 45 }
    };

    rerender();

    await waitFor(() => {
      expect(result.current.scheduleQuery.data?.rows).toHaveLength(45);
    });

    expect(postContinueMock).toHaveBeenCalledTimes(2);
  });

  it('continue が snapshotExpired のとき shell/total/decorations を invalidate する', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    postContinueMock.mockReset();
    postContinueMock.mockResolvedValueOnce({
      page: 1,
      pageSize: 160,
      rows: [],
      snapshotExpired: true
    });

    const { result } = renderHook(
      () =>
        useLeaderboardPhasedScheduleWithAutoAppend({
          leaderboardPhasedParams: leaderboardParams,
          scheduleEnabled: true,
          pauseRefetch: false,
          refetchIntervalMs: 120000,
          macManualOrderV2: false,
          activeDeviceScopeKey: ''
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(postContinueMock).toHaveBeenCalled();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['kiosk-production-schedule', 'leaderboard-shell', leaderboardParams]
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['kiosk-production-schedule', 'leaderboard-total', leaderboardParams]
    });

    expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    // 失効時は追補を打ち切るため、shell 20 行のまま
    await waitFor(() => {
      expect(result.current.scheduleQuery.data?.rows).toHaveLength(20);
    });
  });

  it('continue がネットワークエラー時は appendError を返す', async () => {
    postContinueMock.mockReset();
    postContinueMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(
      () =>
        useLeaderboardPhasedScheduleWithAutoAppend({
          leaderboardPhasedParams: leaderboardParams,
          scheduleEnabled: true,
          pauseRefetch: false,
          refetchIntervalMs: 120000,
          macManualOrderV2: false,
          activeDeviceScopeKey: ''
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.appendError).not.toBeNull();
      expect(result.current.appendError?.message).toContain('network');
    });
  });
});
