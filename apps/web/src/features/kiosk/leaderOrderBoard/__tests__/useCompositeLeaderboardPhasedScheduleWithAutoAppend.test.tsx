import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
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
    const r1a = row('r1-a', 'R1');
    const r1b = row('r1-b', 'R1');
    const r2a = row('r2-a', 'R2');

    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [r1a, r1b, r2a],
      resources: [
        { resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 20 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 20 }
      ]
    });

    const r1c = row('r1-c', 'R1');
    const afterContinue: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [
        row('r1-a', 'R1'),
        row('r1-b', 'R1'),
        r1c,
        row('r2-a', 'R2')
      ],
      deltaRows: [r1c],
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
      const data = latest?.scheduleQuery.data;
      expect(data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r1-c', 'r2-a']);
      expect(data?.rows[0]).toBe(r1a);
      expect(data?.rows[1]).toBe(r1b);
      expect(data?.rows[2]).toBe(r1c);
      expect(data?.rows[3]).toBe(r2a);
      expect(latest?.listIncomplete).toBe(false);
      expect(latest?.appendError).toBeNull();
    });
  });

  it('snapshotId+hasMore で nextCursor が無いとき continue に cursor:0 を載せる', async () => {
    const sid = '550e8400-e29b-41d4-a716-446655440002';
    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 3,
      rows: [row('c1', 'R1'), row('c2', 'R1')],
      resources: [
        {
          resourceCd: 'R1',
          snapshotId: sid,
          hasMore: true,
          total: 3,
          pageSize: 20
        }
      ]
    });

    const afterContinue: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 3,
      rows: [row('c1', 'R1'), row('c2', 'R1'), row('c3', 'R1')],
      resources: [
        {
          resourceCd: 'R1',
          snapshotId: sid,
          hasMore: false,
          nextCursor: 3,
          total: 3,
          pageSize: 20
        }
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
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 20 },
        resourceCdsOrdered: ['R1'],
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
      expect(postContinue).toHaveBeenCalledTimes(1);
    });

    const firstPayload = postContinue.mock.calls[0]![0];
    expect(firstPayload.resourceSlices[0]!.cursor).toBe(0);

    await waitFor(() => {
      expect(latest?.appendError).toBeNull();
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
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

  it('hasMore が続く間は continue を複数回呼び切ってから listIncomplete を下ろす', async () => {
    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('a1', 'R1'), row('a2', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 5, pageSize: 20 }]
    });

    const step1: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('a1', 'R1'), row('a2', 'R1'), row('a3', 'R1'), row('a4', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 4, total: 5, pageSize: 20 }]
    });

    const step2: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('a1', 'R1'), row('a2', 'R1'), row('a3', 'R1'), row('a4', 'R1'), row('a5', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, nextCursor: 5, total: 5, pageSize: 20 }]
    });

    postContinue.mockResolvedValueOnce(step1).mockResolvedValueOnce(step2);

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
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 20 },
        resourceCdsOrdered: ['R1'],
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
      expect(postContinue).toHaveBeenCalledTimes(2);
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
      expect(latest?.listIncomplete).toBe(false);
      expect(latest?.appendError).toBeNull();
    });
  });

  it('continue が snapshotExpired を返すと invalidateQueries で打ち切り、shell の行数のまま残る', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('b1', 'R1'), row('b2', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 5, pageSize: 20 }]
    });

    postContinue.mockResolvedValueOnce(
      boardPayload({
        total: 5,
        rows: [],
        resources: [],
        snapshotExpired: true
      })
    );

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
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 20 },
        resourceCdsOrdered: ['R1'],
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
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(invalidateSpy).toHaveBeenCalled();
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['b1', 'b2']);
      expect(latest?.listIncomplete).toBe(true);
    });

    invalidateSpy.mockRestore();
  });

  it('continue が一時失敗しても appendError を立てず、shell 応答が更新されると続きを取得できる', async () => {
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

    const transient = new AxiosError('Network Error');
    postContinue.mockRejectedValueOnce(transient).mockResolvedValue(afterContinue);

    let boardDataUpdatedAt = 1000;
    boardHookMock.mockImplementation(() => ({
      data: shell,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      dataUpdatedAt: boardDataUpdatedAt
    }));

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

    const utils = render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(latest?.appendError).toBeNull();
    });

    boardDataUpdatedAt = 2000;
    utils.rerender(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(postContinue).toHaveBeenCalledTimes(2);
      expect(latest?.appendError).toBeNull();
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r1-c', 'r2-a']);
      expect(latest?.listIncomplete).toBe(false);
    });
  });

  it('continue が 400 応答などの契約エラーでは appendError を立てる', async () => {
    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [row('r1-a', 'R1'), row('r2-a', 'R2')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 20 }]
    });

    const err400 = new AxiosError('Request failed');
    err400.response = {
      status: 400,
      statusText: 'Bad Request',
      data: {},
      headers: {},
      config: {} as never
    };
    postContinue.mockRejectedValueOnce(err400);

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
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 20 },
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
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(latest?.appendError).toBeInstanceOf(Error);
      expect(latest?.appendError?.message).toBe('Request failed');
    });
  });
});
