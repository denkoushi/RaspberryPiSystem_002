import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUnifiedTagTypeMap, useUnifiedTagTypeMap } from './tools';

import type { UnifiedItem } from '../client';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ getUnifiedItems: vi.fn() }));
vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client')>()),
  getUnifiedItems: mocks.getUnifiedItems
}));

const item = (over: Partial<UnifiedItem>): UnifiedItem => ({
  id: 'id',
  type: 'TOOL',
  name: 'n',
  code: 'c',
  status: 'AVAILABLE',
  createdAt: '',
  updatedAt: '',
  ...over
}) as UnifiedItem;

const items: UnifiedItem[] = [
  item({ id: 't1', type: 'TOOL', nfcTagUid: 'TAG-T' }),
  item({ id: 'm1', type: 'MEASURING_INSTRUMENT', nfcTagUid: 'TAG-M' }),
  item({ id: 'r1', type: 'RIGGING_GEAR', nfcTagUid: 'TAG-R' }),
  item({ id: 'x1', type: 'TOOL', nfcTagUid: null }),
  item({ id: 'x2', type: 'MEASURING_INSTRUMENT', nfcTagUid: '' })
];

let queryClient: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  mocks.getUnifiedItems.mockResolvedValue(items);
});
afterEach(() => queryClient.clear());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useUnifiedTagTypeMap', () => {
  it('builds the same tagUid -> type map as the previous per-page effect', () => {
    expect(buildUnifiedTagTypeMap(items)).toEqual({
      'TAG-T': 'TOOL',
      'TAG-M': 'MEASURING_INSTRUMENT',
      'TAG-R': 'RIGGING_GEAR'
    });
  });

  it('fetches category ALL once and reuses the cached map on remount', async () => {
    const first = renderHook(() => useUnifiedTagTypeMap(), { wrapper });
    expect(first.result.current).toEqual({});
    await waitFor(() => expect(first.result.current).toEqual(buildUnifiedTagTypeMap(items)));
    expect(mocks.getUnifiedItems).toHaveBeenCalledTimes(1);
    expect(mocks.getUnifiedItems).toHaveBeenCalledWith({ category: 'ALL' });
    first.unmount();

    const second = renderHook(() => useUnifiedTagTypeMap(), { wrapper });
    expect(second.result.current).toEqual(buildUnifiedTagTypeMap(items));
    expect(mocks.getUnifiedItems).toHaveBeenCalledTimes(1);
  });

  it('keeps an empty map without retrying when the fetch fails', async () => {
    mocks.getUnifiedItems.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => useUnifiedTagTypeMap(), { wrapper });
    await waitFor(() => expect(queryClient.getQueryState(['unified-items', 'tag-type-map'])?.status).toBe('error'));
    expect(result.current).toEqual({});
    expect(mocks.getUnifiedItems).toHaveBeenCalledTimes(1);
  });
});
