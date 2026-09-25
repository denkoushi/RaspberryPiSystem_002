import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { patchSelfInspectionSessionCachesAfterEntrySave } from '../../features/part-measurement/mergeSelfInspectionSessionAfterEntrySave';
import { getSelfInspectionSession } from '../client';


import { useSelfInspectionSession } from './part-measurement';

import type { SelfInspectionLotEntryDto, SelfInspectionSessionDetailDto } from '../../features/part-measurement/types';
import type { PropsWithChildren } from 'react';

vi.mock('../client', () => ({
  getSelfInspectionSession: vi.fn()
}));

const getSession = vi.mocked(getSelfInspectionSession);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function session(entryIndexes: number[], focusedEntryIndex: number | null): SelfInspectionSessionDetailDto {
  return {
    id: 'session-a',
    entries: entryIndexes.map((entryIndex) => ({ entryIndex, updatedAt: `u${entryIndex}` })),
    focusedEntry: focusedEntryIndex == null ? null : { entryIndex: focusedEntryIndex, values: [] }
  } as unknown as SelfInspectionSessionDetailDto;
}

describe('useSelfInspectionSession entry switch', () => {
  beforeEach(() => getSession.mockReset());

  it('shows an unsaved next entry immediately as real data and refetches in the background', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['self-inspection-session', 'session-a', 0], session([0], 0));
    let resolveFetch: (value: SelfInspectionSessionDetailDto) => void = () => {};
    getSession.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

    const { result } = renderHook(() => useSelfInspectionSession('session-a', { entryIndex: 1 }), {
      wrapper: wrapper(queryClient)
    });

    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.isSeedPending).toBe(true);
    expect(result.current.data?.focusedEntry).toBeNull();
    expect(result.current.data?.entries.map((entry) => entry.entryIndex)).toEqual([0]);
    await waitFor(() => expect(getSession).toHaveBeenCalledWith('session-a', { entryIndex: 1 }));

    resolveFetch(session([0, 1], null));
    await waitFor(() => expect(result.current.isSeedPending).toBe(false));
    expect(result.current.data?.entries.map((entry) => entry.entryIndex)).toEqual([0, 1]);
  });

  it('does not let an entry save patch end the pending state of a seeded entry', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['self-inspection-session', 'session-a', 0], session([0], 0));
    getSession.mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useSelfInspectionSession('session-a', { entryIndex: 1 }), {
      wrapper: wrapper(queryClient)
    });
    expect(result.current.isSeedPending).toBe(true);

    patchSelfInspectionSessionCachesAfterEntrySave(queryClient, 'session-a', {
      entryIndex: 0,
      id: 'entry-0',
      updatedAt: 'u0-2',
      persistenceStatus: 'draft',
      values: []
    } as unknown as SelfInspectionLotEntryDto);

    expect(queryClient.getQueryState(['self-inspection-session', 'session-a', 1])?.dataUpdateCount).toBe(0);
    expect(result.current.isSeedPending).toBe(true);
  });

  it('keeps the placeholder path for an entry already saved on the server', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['self-inspection-session', 'session-a', 1], session([0, 1], 1));
    getSession.mockImplementation(async (_id, options) => session([0, 1], options?.entryIndex ?? null));

    const { result, rerender } = renderHook(
      ({ entryIndex }: { entryIndex: number }) => useSelfInspectionSession('session-a', { entryIndex }),
      { wrapper: wrapper(queryClient), initialProps: { entryIndex: 1 } }
    );
    rerender({ entryIndex: 0 });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.isSeedPending).toBe(false);
    await waitFor(() => expect(result.current.data?.focusedEntry?.entryIndex).toBe(0));
  });
});
