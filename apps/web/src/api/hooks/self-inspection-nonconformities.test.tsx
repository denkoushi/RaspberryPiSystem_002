import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSelfInspectionNonconformities } from '../client';

import { useSelfInspectionNonconformities } from './self-inspection-nonconformities';

import type { PropsWithChildren } from 'react';

vi.mock('../client', () => ({
  getSelfInspectionNonconformities: vi.fn()
}));

const getItems = vi.mocked(getSelfInspectionNonconformities);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSelfInspectionNonconformities', () => {
  beforeEach(() => getItems.mockReset());

  it('uses the canonical part in the query key and fetches only when enabled', async () => {
    getItems.mockResolvedValueOnce([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(
      () => useSelfInspectionNonconformities(' ｐａｒｔ－１ ', { enabled: true }),
      { wrapper: wrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getItems).toHaveBeenCalledWith('PART-1', expect.any(AbortSignal));
    expect(queryClient.getQueryCache().find({
      queryKey: ['self-inspection', 'nonconformities', 'PART-1']
    })).toBeDefined();
  });

  it('stays idle for a blank part or a closed viewer', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const blank = renderHook(() => useSelfInspectionNonconformities('  '), {
      wrapper: wrapper(queryClient)
    });
    const closed = renderHook(() => useSelfInspectionNonconformities('PART-1', { enabled: false }), {
      wrapper: wrapper(queryClient)
    });

    expect(blank.result.current.fetchStatus).toBe('idle');
    expect(closed.result.current.fetchStatus).toBe('idle');
    expect(getItems).not.toHaveBeenCalled();
  });
});
