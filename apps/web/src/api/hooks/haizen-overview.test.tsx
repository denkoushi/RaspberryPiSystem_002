import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { deleteOrderPlacementBranch } from '../domains/mobile-placement';

import { useDeleteOrderPlacementBranch } from './haizen-overview';

import type { PropsWithChildren } from 'react';

vi.mock('../domains/mobile-placement', () => ({ deleteOrderPlacementBranch: vi.fn() }));
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient();
  vi.mocked(deleteOrderPlacementBranch).mockReset().mockResolvedValue({ deleted: { id: 'branch' } } as never);
});
afterEach(() => { client.clear(); vi.restoreAllMocks(); });

it('keeps mutation context out of the optional delete precondition', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(useDeleteOrderPlacementBranch, { wrapper: Wrapper });
  await act(async () => { await result.current.mutateAsync('branch'); });
  expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith('branch');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mobile-placement', 'haizen-overview'] });
});
