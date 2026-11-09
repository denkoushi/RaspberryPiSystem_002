import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../queryKeys/productionSchedule';

import { useKioskGrindingPlanningBoardLoad, useKioskGrindingPlanningBoardProgressive, useKioskSessakuPieceMutations } from './production-schedule/grinding-planning-board';

import type { GrindingPlanningBoardResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ split: vi.fn(), merge: vi.fn(), completion: vi.fn(), board: vi.fn(), load: vi.fn() }));
vi.mock('../client', () => ({ splitKioskSessakuPieces: mocks.split, mergeKioskSessakuPieces: mocks.merge, setKioskSessakuPieceCompletion: mocks.completion, getKioskGrindingPlanningBoard: mocks.board, getKioskGrindingPlanningBoardLoad: mocks.load }));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0 } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const hook = renderHook(useKioskSessakuPieceMutations, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, invalidate, client };
}

function boardResponse(version: number): GrindingPlanningBoardResponse {
  return {
    siteKey: 'site', category: 'cutting', view: 'seiban', boardVersion: version,
    sourceRevision: JSON.stringify({ boardVersion: version, orderHash: 'same-order' }),
    registeredFseibans: [], seibanOrder: [], resources: [], items: [], load: [],
    unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId: `snapshot-${version}`, nextCursor: null
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setupProgressive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const loadKey = productionScheduleQueryKeys.grindingPlanningBoardLoad('cutting');
  mocks.board.mockResolvedValue(boardResponse(1));
  mocks.load.mockResolvedValue({ load: [], unknownRequiredMinutesCount: 0 });
  const hook = renderHook(() => ({
    board: useKioskGrindingPlanningBoardProgressive({ category: 'cutting', view: 'seiban', includePieces: true }),
    load: useKioskGrindingPlanningBoardLoad('cutting'),
    mutations: useKioskSessakuPieceMutations()
  }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, client, loadKey };
}

describe('piece mutations', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('invalidates board, candidates, load, chips, arrivals and parent consumers after completion', async () => {
    const h = setup(); mocks.completion.mockResolvedValue({ pieces: [] });
    const payload = { pieceId: 'id', intent: 'complete' as const, expectedPieceSetVersion: 4, itemRevision: 'r' };
    await act(async () => { await h.result.current.completion.mutateAsync(payload); });
    expect(mocks.completion).toHaveBeenCalledWith('id', { intent: 'complete', expectedPieceSetVersion: 4, itemRevision: 'r' });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll, refetchType: 'none' });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll, predicate: expect.any(Function) });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.scheduleAll });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.orderUsageAll });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.historyProgressAll });
    expect(h.invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardDueDetail(null).slice(0, 1) });
    expect(h.invalidate).toHaveBeenCalledTimes(6);
  });
  it('marks board consumers stale without fetching, leaving exactly one board GET to the caller', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const board = vi.fn().mockResolvedValue({ items: [] });
    const load = vi.fn().mockResolvedValue({ items: [] });
    const keys = [productionScheduleQueryKeys.grindingPlanningBoard({ includePieces: true }),
      productionScheduleQueryKeys.grindingPlanningBoardLoad('cutting'),
      productionScheduleQueryKeys.grindingPlanningBoardSeibanCandidates(),
      productionScheduleQueryKeys.grindingPlanningBoardProcessChips([])];
    for (const key of keys) client.setQueryData(key, { items: [] });
    const hook = renderHook(() => ({ query: useQuery({ queryKey: keys[0], queryFn: board }), load: useQuery({ queryKey: keys[1], queryFn: load }), mutations: useKioskSessakuPieceMutations() }), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    });
    mocks.split.mockResolvedValue({ pieces: [] });
    await act(async () => { await hook.result.current.mutations.split.mutateAsync({ parentItemId: 'parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' }); });
    expect(board).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    for (const key of [keys[0], ...keys.slice(2)]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    await act(async () => { await hook.result.current.query.refetch(); });
    await waitFor(() => expect(board).toHaveBeenCalledTimes(1));
  });
  it.each(['split', 'merge'] as const)('%s refreshes load once, independently of board, when load finishes first', async (operation) => {
    const h = setupProgressive();
    await waitFor(() => expect(h.result.current.board.isComplete).toBe(true));
    await waitFor(() => expect(h.result.current.load.isSuccess).toBe(true));
    mocks[operation].mockResolvedValue({ pieces: [] });
    const board = deferred<GrindingPlanningBoardResponse>();
    mocks.board.mockReturnValue(board.promise);
    let refresh!: ReturnType<typeof h.result.current.board.refetch>;
    await act(async () => {
      if (operation === 'split') await h.result.current.mutations.split.mutateAsync({ parentItemId: 'parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' });
      else await h.result.current.mutations.merge.mutateAsync({ parentItemId: 'parent', pieceIds: ['a', 'b'], expectedPieceSetVersion: 1, itemRevisions: { a: 'a', b: 'b' } });
      refresh = h.result.current.board.refetch({ loadAlreadyInvalidated: true });
    });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(mocks.board).toHaveBeenCalledTimes(2);
    await act(async () => { board.resolve(boardResponse(2)); });
    await refresh;
    expect(h.result.current.board.data?.boardVersion).toBe(2);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('starts board before load completes and does not refresh load again when board finishes first', async () => {
    const h = setupProgressive();
    await waitFor(() => expect(h.result.current.board.isComplete).toBe(true));
    await waitFor(() => expect(h.result.current.load.isSuccess).toBe(true));
    const load = deferred<{ load: []; unknownRequiredMinutesCount: number }>();
    mocks.load.mockReturnValue(load.promise);
    mocks.split.mockResolvedValue({ pieces: [] });
    mocks.board.mockResolvedValue(boardResponse(2));
    let mutationFinished = false;
    await act(async () => {
      await h.result.current.mutations.split.mutateAsync({ parentItemId: 'parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' });
      mutationFinished = true;
    });
    expect(mutationFinished).toBe(true);
    await h.result.current.board.refetch({ loadAlreadyInvalidated: true });
    expect(h.result.current.board.data?.boardVersion).toBe(2);
    expect(mocks.board).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    await act(async () => { load.resolve({ load: [], unknownRequiredMinutesCount: 0 }); });
    await waitFor(() => expect(h.client.getQueryState(h.loadKey)?.fetchStatus).toBe('idle'));
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('refreshes completion load once even without a board version change', async () => {
    const h = setupProgressive();
    await waitFor(() => expect(h.result.current.board.isComplete).toBe(true));
    await waitFor(() => expect(h.result.current.load.isSuccess).toBe(true));
    mocks.completion.mockResolvedValue({ pieces: [] });
    await act(async () => {
      await h.result.current.mutations.completion.mutateAsync({ pieceId: 'piece', intent: 'complete', expectedPieceSetVersion: 1, itemRevision: 'r' });
    });
    await h.result.current.board.refetch({ loadAlreadyInvalidated: true });
    expect(mocks.board).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('invalidates load even when the replacement board fails', async () => {
    const h = setupProgressive();
    await waitFor(() => expect(h.result.current.board.isComplete).toBe(true));
    await waitFor(() => expect(h.result.current.load.isSuccess).toBe(true));
    mocks.split.mockResolvedValue({ pieces: [] });
    mocks.board.mockRejectedValue(new Error('board unavailable'));
    mocks.load.mockRejectedValue(new Error('load unavailable'));
    await act(async () => { await h.result.current.mutations.split.mutateAsync({ parentItemId: 'parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' }); });
    expect((await h.result.current.board.refetch({ loadAlreadyInvalidated: true })).isError).toBe(true);
    await waitFor(() => expect(h.client.getQueryState(h.loadKey)?.fetchStatus).toBe('idle'));
    expect(h.client.getQueryState(h.loadKey)?.isInvalidated).toBe(true);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    // Failed board refresh does not suppress the next independently observed revision.
    mocks.board.mockResolvedValue(boardResponse(2));
    mocks.load.mockResolvedValue({ load: [], unknownRequiredMinutesCount: 0 });
    await h.result.current.board.refetch();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
  });
  it('does not retry a stale split, including when the client defaults to retrying', async () => {
    const h = setup(); const error = { response: { status: 409 } }; mocks.split.mockRejectedValue(error);
    await act(async () => { await expect(h.result.current.split.mutateAsync({ parentItemId: 'parent', quantities: [2, 3], expectedPieceSetVersion: 0, itemRevision: 'r' })).rejects.toBe(error); });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(h.invalidate).not.toHaveBeenCalled();
  });
});
