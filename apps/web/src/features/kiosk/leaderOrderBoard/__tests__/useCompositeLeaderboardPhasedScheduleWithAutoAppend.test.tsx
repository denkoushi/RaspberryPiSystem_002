import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '../../../../api/client';
import { useCompositeLeaderboardPhasedScheduleWithAutoAppend } from '../useCompositeLeaderboardPhasedScheduleWithAutoAppend';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

vi.mock('../../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/client')>();
  return {
    ...actual,
    postKioskProductionScheduleLeaderboardBoardContinue: vi.fn()
  };
});

const postContinue = vi.mocked(client.postKioskProductionScheduleLeaderboardBoardContinue);

const boardHookMock = vi.fn();

vi.mock('../../../../api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../api/hooks')>();
  return {
    ...actual,
    useKioskProductionScheduleLeaderboardBoard: (...args: unknown[]) => boardHookMock(...args)
  };
});

function row(id: string, resourceCd: string): ProductionScheduleRow {
  return {
    id,
    rowData: { FSIGENCD: resourceCd, ProductNo: id, FSEIBAN: `S-${id}`, FHINCD: `P-${id}` }
  } as unknown as ProductionScheduleRow;
}

function boardPayload(partial: Partial<ProductionScheduleLeaderboardBoardResponse>): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 20,
    total: 0,
    rows: [],
    resources: [],
    ...partial
  };
}

describe('useCompositeLeaderboardPhasedScheduleWithAutoAppend', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    boardHookMock.mockReset();
    postContinue.mockReset();
  });

  it('集約 API の rows をスロット順のまま返し、未到達カードがあれば listIncomplete を立て、continue で完了できる', async () => {
    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [row('r1-a', 'R1'), row('r1-b', 'R1'), row('r2-a', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 20 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 20 }
      ]
    });

    const afterContinue: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [row('r1-a', 'R1'), row('r1-b', 'R1'), row('r1-c', 'R1'), row('r2-a', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: false, nextCursor: 3, total: 3, pageSize: 20 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 20 }
      ]
    });

    postContinue.mockResolvedValue(afterContinue);

    boardHookMock.mockReturnValue({
      data: shell,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 20
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: ''
      });
      return null;
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(latest?.listIncomplete).toBe(true);
    });

    await waitFor(() => {
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r1-c', 'r2-a']);
      expect(latest?.listIncomplete).toBe(false);
      expect(latest?.appendError).toBeNull();
    });
  });

  it('GET 応答待ちの間は loading、feedMounts は不要（null）', () => {
    boardHookMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
      isSuccess: false,
      dataUpdatedAt: 0
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 20
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: ''
      });
      return null;
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    expect(latest?.scheduleQuery.isLoading).toBe(true);
    expect(latest?.feedMounts).toBeNull();
  });
});
