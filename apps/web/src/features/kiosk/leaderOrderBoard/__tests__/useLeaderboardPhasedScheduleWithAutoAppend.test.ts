import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLeaderboardPhasedScheduleWithAutoAppend } from '../useLeaderboardPhasedScheduleWithAutoAppend';

import type { ProductionScheduleRow } from '../../../../api/client';

const postContinueMock = vi.fn();

let shellQueryMock: {
  data: { page: number; pageSize: number; total: number; rows: ProductionScheduleRow[] } | undefined;
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
  data: { rowDecorations: Array<{ id: string; resolvedMachineName?: string | null; customerName?: string | null }>; leaderboardFooterChipsByPartKey: Record<string, never> };
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
  beforeEach(() => {
    const shellRows = makeRows(1, 20);
    shellQueryMock = {
      data: { page: 1, pageSize: 160, total: 45, rows: shellRows },
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
      .mockResolvedValueOnce({ page: 1, pageSize: 160, total: 45, rows: makeRows(21, 20) })
      .mockResolvedValueOnce({ page: 1, pageSize: 160, total: 45, rows: makeRows(41, 5) });
  });

  it('同一 shell / total の再レンダーでは continue を連打しない', async () => {
    const { result, rerender } = renderHook(() =>
      useLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedParams: { pageSize: 160, allowResourceOnly: true },
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: ''
      })
    );

    await waitFor(() => {
      expect(postContinueMock).toHaveBeenCalledTimes(2);
      expect(result.current.scheduleQuery.data?.rows).toHaveLength(45);
    });

    shellQueryMock = {
      ...shellQueryMock,
      data: { ...shellQueryMock.data!, rows: [...shellQueryMock.data!.rows] }
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
});
