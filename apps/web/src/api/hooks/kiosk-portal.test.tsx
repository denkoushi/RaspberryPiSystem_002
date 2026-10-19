import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskConfig, useUpdateKioskPortalCards } from './kiosk';

import type { KioskConfig } from '../domains/kiosk';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('../client', () => ({ putKioskPortalCards: mocks.put, getKioskConfig: mocks.get }));
let queryClient: QueryClient;
let serverConfig: KioskConfig;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  serverConfig = { theme: 'factory-dark', greeting: '', idleTimeoutMs: 30000, portalHiddenTabIds: [] };
  mocks.get.mockImplementation(async () => serverConfig);
  mocks.put.mockImplementation(async (hiddenTabIds: string[]) => {
    serverConfig = { ...serverConfig, portalHiddenTabIds: hiddenTabIds };
    return { ok: true, portalHiddenTabIds: hiddenTabIds };
  });
});
afterEach(() => queryClient.clear());

function setup() {
  return renderHook(() => ({ config: useKioskConfig(), mutation: useUpdateKioskPortalCards('self-device-key') }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  });
}

describe('portal card config mutation', () => {
  it('saves for this device, updates the cache and refetches kiosk config', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.config.isSuccess).toBe(true));
    mocks.get.mockClear();
    await act(async () => { await result.current.mutation.mutateAsync(['borrow']); });
    expect(mocks.put).toHaveBeenCalledWith(['borrow'], 'self-device-key');
    await waitFor(() => expect(result.current.config.data?.portalHiddenTabIds).toEqual(['borrow']));
    expect(mocks.get).toHaveBeenCalled();
    expect(queryClient.getQueryData<KioskConfig>(['kiosk-config'])?.portalHiddenTabIds).toEqual(['borrow']);
  });
  it('preserves the saved config when a write fails', async () => {
    mocks.put.mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    await waitFor(() => expect(result.current.config.isSuccess).toBe(true));
    await act(async () => { await expect(result.current.mutation.mutateAsync(['borrow'])).rejects.toThrow('offline'); });
    expect(result.current.config.data?.portalHiddenTabIds).toEqual([]);
  });
});
