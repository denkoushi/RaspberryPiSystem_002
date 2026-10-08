import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { cancelInventoryTransaction, correctInventoryStock, processInventoryTransaction, type InventoryItem } from '../../../api/client';
import { useInventoryMutations } from '../../../api/hooks/item-inventory';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/client')>(),
  processInventoryTransaction: vi.fn(),
  correctInventoryStock: vi.fn(),
  cancelInventoryTransaction: vi.fn(),
}));

const transaction = { id: 't1', compartmentId: 'c1', afterQuantity: 8, action: 'ISSUE', createdAt: '2026-10-08T01:00:00Z' };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const items = [{ id: 'i1', compartments: [{ id: 'c1', stockQuantity: 10, lastIssuedAt: 'old' }, { id: 'c2', stockQuantity: 20, lastIssuedAt: null }] }] as InventoryItem[];
  client.setQueryData(['inventory-items'], items);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useInventoryMutations(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { client, invalidate, hook, items };
}

describe('inventory stock mutation caches', () => {
  it.each(['ISSUE', 'RESTOCK'])('updates transaction stock and only ISSUE updates the issue time (%s)', async (action) => {
    vi.mocked(processInventoryTransaction).mockResolvedValue({ transaction: { ...transaction, action } } as never);
    const { client, invalidate, hook, items } = setup();
    await act(async () => { await hook.result.current.transaction.mutateAsync({ itemTagUid: 'i', quantityTagUid: 'q' }); });
    const updated = client.getQueryData<InventoryItem[]>(['inventory-items'])!;
    expect(updated[0].compartments[0]).toMatchObject({ stockQuantity: 8, lastIssuedAt: action === 'ISSUE' ? transaction.createdAt : 'old' });
    expect(updated[0].compartments[1]).toBe(items[0].compartments[1]);
    expect(invalidate.mock.calls.map(([input]) => input?.queryKey)).toEqual([['inventory-history'], ['inventory-locations'], ['inventory-tags']]);
  });

  it('updates corrections without changing the issue date or unrelated query keys', async () => {
    vi.mocked(correctInventoryStock).mockResolvedValue({ transaction: { ...transaction, action: 'CORRECTION' } } as never);
    const { client, invalidate, hook } = setup();
    await act(async () => { await hook.result.current.correction.mutateAsync({ compartmentId: 'c1', desiredQuantity: 8, expectedBeforeQuantity: 10 }); });
    expect(client.getQueryData<InventoryItem[]>(['inventory-items'])![0].compartments[0]).toMatchObject({ stockQuantity: 8, lastIssuedAt: 'old' });
    expect(invalidate.mock.calls.map(([input]) => input?.queryKey)).toEqual([['inventory-history'], ['inventory-locations'], ['inventory-tags']]);
  });

  it('invalidates exactly the four stock keys when cancelling', async () => {
    vi.mocked(cancelInventoryTransaction).mockResolvedValue({ transaction: { ...transaction, action: 'CANCEL' } } as never);
    const { invalidate, hook } = setup();
    await act(async () => { await hook.result.current.cancel.mutateAsync('t1'); });
    expect(invalidate.mock.calls.map(([input]) => input?.queryKey)).toEqual([['inventory-items'], ['inventory-history'], ['inventory-locations'], ['inventory-tags']]);
  });
});
