import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, act } from '@testing-library/react';
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
    postKioskProductionScheduleLeaderboardBoardContinue: vi.fn(),
    postKioskProductionScheduleLeaderboardDecorations: vi.fn().mockResolvedValue({
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    })
  };
});

const postContinue = vi.mocked(client.postKioskProductionScheduleLeaderboardBoardContinue);
const postDecorations = vi.mocked(client.postKioskProductionScheduleLeaderboardDecorations);

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
    pageSize: 80,
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
    postDecorations.mockClear();
    postDecorations.mockResolvedValue({
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    });
  });

  it('board 取得は includeDecorations=false で行い、行があれば装飾 API を呼ぶ', async () => {
    const shell = boardPayload({
      total: 1,
      rows: [row('d1', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    });
    boardHookMock.mockReturnValue({
      data: shell,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    function Harness() {
      useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 80 },
        resourceCdsOrdered: ['R1'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(boardHookMock).toHaveBeenCalled();
      const params = boardHookMock.mock.calls[0]![0] as { includeDecorations?: boolean };
      expect(params.includeDecorations).toBe(false);
      expect(postDecorations).toHaveBeenCalled();
    });
  });

  it('集約 API の rows をスロット順のまま返し、未到達カードがあれば listIncomplete を立て、continue で完了できる', async () => {
    const r1a = row('r1-a', 'R1');
    const r1b = row('r1-b', 'R1');
    const r2a = row('r2-a', 'R2');

    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [r1a, r1b, r2a],
      resources: [
        { resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 80 }
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
        { resourceCd: 'R1', hasMore: false, nextCursor: 3, total: 3, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 80 }
      ]
    });

    postContinue.mockResolvedValue(afterContinue);

    boardHookMock.mockReturnValue({
      data: shell,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 10
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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
          pageSize: 80
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
          pageSize: 80
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
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 10 },
        resourceCdsOrdered: ['R1'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(postContinue).toHaveBeenCalledTimes(1);
    });

    const firstPayload = postContinue.mock.calls[0]![0];
    expect(firstPayload.pageSize).toBe(40);
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
      isPlaceholderData: false,
      dataUpdatedAt: 0
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 10
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 5, pageSize: 80 }]
    });

    const step1: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('a1', 'R1'), row('a2', 'R1'), row('a3', 'R1'), row('a4', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 4, total: 5, pageSize: 80 }]
    });

    const step2: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 5,
      rows: [row('a1', 'R1'), row('a2', 'R1'), row('a3', 'R1'), row('a4', 'R1'), row('a5', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, nextCursor: 5, total: 5, pageSize: 80 }]
    });

    postContinue.mockResolvedValueOnce(step1).mockResolvedValueOnce(step2);

    boardHookMock.mockReturnValue({
      data: shell,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 10 },
        resourceCdsOrdered: ['R1'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 5, pageSize: 80 }]
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
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 10 },
        resourceCdsOrdered: ['R1'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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
        { resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 80 }
      ]
    });

    const afterContinue: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [row('r1-a', 'R1'), row('r1-b', 'R1'), row('r1-c', 'R1'), row('r2-a', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: false, nextCursor: 3, total: 3, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, nextCursor: 1, total: 1, pageSize: 80 }
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
      isPlaceholderData: false,
      dataUpdatedAt: boardDataUpdatedAt
    }));

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 10
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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

  it('追補完了後に shell が refetch で行数だけ減っても表示行数は維持する', async () => {
    const r1a = row('r1-a', 'R1');
    const r1b = row('r1-b', 'R1');
    const r1c = row('r1-c', 'R1');

    const shellSmall: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 3,
      rows: [r1a, r1b],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 80 }]
    });

    const afterContinue: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 3,
      rows: [r1a, r1b, r1c],
      resources: [{ resourceCd: 'R1', hasMore: false, nextCursor: 3, total: 3, pageSize: 80 }]
    });

    postContinue.mockResolvedValue(afterContinue);

    let boardDataUpdatedAt = 1000;
    boardHookMock.mockImplementation(() => ({
      data: shellSmall,
      isLoading: false,
      isError: false,
      isFetching: false,
      isSuccess: true,
      isPlaceholderData: false,
      dataUpdatedAt: boardDataUpdatedAt
    }));

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 10 },
        resourceCdsOrdered: ['R1'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    const utils = render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r1-c']);
    });

    const continueCallsAfterComplete = postContinue.mock.calls.length;

    boardDataUpdatedAt = 2000;
    boardHookMock.mockImplementation(() => ({
      data: shellSmall,
      isLoading: false,
      isError: false,
      isFetching: true,
      isSuccess: true,
      isPlaceholderData: true,
      dataUpdatedAt: boardDataUpdatedAt
    }));
    utils.rerender(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r1-c']);
      expect(postContinue.mock.calls.length).toBe(continueCallsAfterComplete);
    });
  });

  it('continue が 400 応答などの契約エラーでは appendError を立てる', async () => {
    const shell: ProductionScheduleLeaderboardBoardResponse = boardPayload({
      total: 4,
      rows: [row('r1-a', 'R1'), row('r2-a', 'R2')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 2, total: 3, pageSize: 80 }]
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
      isPlaceholderData: false,
      dataUpdatedAt: Date.now()
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: { allowResourceOnly: true, pageSize: 10 },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
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

  it('params 変更後の placeholder（旧 q の shell）は表示せず、本物の shell で全件に戻る', async () => {
    const filteredShell = boardPayload({
      total: 1,
      rows: [row('only-filtered', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    });
    const fullShell = boardPayload({
      total: 3,
      rows: [row('r1-a', 'R1'), row('r1-b', 'R1'), row('r2-a', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
      ]
    });

    let phase: 'filtered' | 'placeholderStale' | 'full' = 'filtered';

    boardHookMock.mockImplementation(() => {
      if (phase === 'full') {
        return {
          data: fullShell,
          isLoading: false,
          isError: false,
          isFetching: false,
          isSuccess: true,
          isPlaceholderData: false,
          dataUpdatedAt: Date.now()
        };
      }
      if (phase === 'placeholderStale') {
        return {
          data: filteredShell,
          isLoading: false,
          isError: false,
          isFetching: true,
          isSuccess: true,
          isPlaceholderData: true,
          dataUpdatedAt: Date.now()
        };
      }
      return {
        data: filteredShell,
        isLoading: false,
        isError: false,
        isFetching: false,
        isSuccess: true,
        isPlaceholderData: false,
        dataUpdatedAt: Date.now()
      };
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;
    let withQ = true;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 80,
          ...(withQ ? { q: 'AA1S7M11' } : {})
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    const tree = () =>
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness));

    const utils = render(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['only-filtered']);
    });

    act(() => {
      withQ = false;
      phase = 'placeholderStale';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.isLoading).toBe(true);
      expect(latest?.scheduleQuery.data?.rows.length ?? 0).toBe(0);
    });

    act(() => {
      phase = 'full';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r2-a']);
      expect(latest?.scheduleQuery.isLoading).toBe(false);
    });

    expect(postContinue).not.toHaveBeenCalled();
  });

  it('params 変更後に旧 params の continue 応答が遅れて返っても表示を上書きしない', async () => {
    const filteredShell = boardPayload({
      total: 2,
      rows: [row('old-1', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 1, total: 2, pageSize: 80 }]
    });
    const fullShell = boardPayload({
      total: 3,
      rows: [row('new-1', 'R1'), row('new-2', 'R1'), row('new-3', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
      ]
    });
    const staleContinueResult = boardPayload({
      total: 2,
      rows: [row('old-1', 'R1'), row('old-2', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, nextCursor: 2, total: 2, pageSize: 80 }]
    });

    let phase: 'filtered' | 'placeholderStale' | 'full' = 'filtered';
    boardHookMock.mockImplementation(() => {
      if (phase === 'full') {
        return {
          data: fullShell,
          isLoading: false,
          isError: false,
          isFetching: false,
          isSuccess: true,
          isPlaceholderData: false,
          dataUpdatedAt: Date.now()
        };
      }
      if (phase === 'placeholderStale') {
        return {
          data: filteredShell,
          isLoading: false,
          isError: false,
          isFetching: true,
          isSuccess: true,
          isPlaceholderData: true,
          dataUpdatedAt: Date.now()
        };
      }
      return {
        data: filteredShell,
        isLoading: false,
        isError: false,
        isFetching: false,
        isSuccess: true,
        isPlaceholderData: false,
        dataUpdatedAt: Date.now()
      };
    });

    let resolveContinue: ((v: ProductionScheduleLeaderboardBoardResponse) => void) | undefined;
    postContinue.mockImplementation(
      () =>
        new Promise<ProductionScheduleLeaderboardBoardResponse>((resolve) => {
          resolveContinue = resolve;
        })
    );

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;
    let withQ = true;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 80,
          ...(withQ ? { q: 'AA1S7M11' } : {})
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    const tree = () =>
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness));

    const utils = render(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['old-1']);
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(resolveContinue).toBeTypeOf('function');
    });

    act(() => {
      withQ = false;
      phase = 'placeholderStale';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.isLoading).toBe(true);
      expect(latest?.scheduleQuery.data?.rows.length ?? 0).toBe(0);
    });

    act(() => {
      phase = 'full';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['new-1', 'new-2', 'new-3']);
    });

    act(() => {
      resolveContinue?.(staleContinueResult);
    });

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['new-1', 'new-2', 'new-3']);
    });
  });

  it('hasMore ありで continue 完走後、製番 OFF（q 削除）と placeholder 経由で全件 shell に戻る', async () => {
    const filteredShell = boardPayload({
      total: 5,
      rows: [row('only-filtered', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: true, nextCursor: 1, total: 5, pageSize: 80 }]
    });
    const filteredAfterContinue = boardPayload({
      total: 2,
      rows: [row('only-filtered', 'R1'), row('filt-2', 'R1')],
      resources: [{ resourceCd: 'R1', hasMore: false, nextCursor: 2, total: 2, pageSize: 80 }]
    });
    const fullShell = boardPayload({
      total: 3,
      rows: [row('r1-a', 'R1'), row('r1-b', 'R1'), row('r2-a', 'R2')],
      resources: [
        { resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
      ]
    });

    postContinue.mockResolvedValue(filteredAfterContinue);

    let phase: 'filtered' | 'placeholderStale' | 'full' = 'filtered';

    boardHookMock.mockImplementation(() => {
      if (phase === 'full') {
        return {
          data: fullShell,
          isLoading: false,
          isError: false,
          isFetching: false,
          isSuccess: true,
          isPlaceholderData: false,
          dataUpdatedAt: Date.now()
        };
      }
      if (phase === 'placeholderStale') {
        return {
          data: filteredShell,
          isLoading: false,
          isError: false,
          isFetching: true,
          isSuccess: true,
          isPlaceholderData: true,
          dataUpdatedAt: Date.now()
        };
      }
      return {
        data: filteredShell,
        isLoading: false,
        isError: false,
        isFetching: false,
        isSuccess: true,
        isPlaceholderData: false,
        dataUpdatedAt: Date.now()
      };
    });

    let latest: ReturnType<typeof useCompositeLeaderboardPhasedScheduleWithAutoAppend> | undefined;
    let withQ = true;

    function Harness() {
      latest = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
        leaderboardPhasedBaseParams: {
          allowResourceOnly: true,
          pageSize: 80,
          ...(withQ ? { q: 'AA1S7M11' } : {})
        },
        resourceCdsOrdered: ['R1', 'R2'],
        scheduleEnabled: true,
        pauseRefetch: false,
        refetchIntervalMs: 120000,
        macManualOrderV2: false,
        activeDeviceScopeKey: '',
        siteKey: 'test-site'
      });
      return null;
    }

    const tree = () =>
      createElement(QueryClientProvider, { client: queryClient }, createElement(Harness));

    const utils = render(tree());

    await waitFor(() => {
      expect(postContinue).toHaveBeenCalledTimes(1);
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['only-filtered', 'filt-2']);
      expect(latest?.listIncomplete).toBe(false);
    });

    act(() => {
      withQ = false;
      phase = 'placeholderStale';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.isLoading).toBe(true);
      expect(latest?.scheduleQuery.data?.rows.length ?? 0).toBe(0);
    });

    act(() => {
      phase = 'full';
    });
    utils.rerender(tree());

    await waitFor(() => {
      expect(latest?.scheduleQuery.data?.rows.map((r) => r.id)).toEqual(['r1-a', 'r1-b', 'r2-a']);
      expect(latest?.scheduleQuery.isLoading).toBe(false);
    });

    expect(postContinue).toHaveBeenCalledTimes(1);
  });
});
