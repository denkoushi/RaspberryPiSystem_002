import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteInventoryDrawer, deleteInventoryShelf, deleteInventoryTag, dismissInventoryImport, restoreInventoryImport, getInventoryImports, getInventoryImportMessages, getInventoryToolFieldValues } from '../../../../api/client';
import { useInventoryImports, useInventoryImportMessages, useInventoryToolFieldValues, useInventoryMutations } from '../../../../api/hooks/item-inventory';

import { captureSetupPinSession, clearSetupPin, readSetupPin, rememberSetupPin, sendSetupRequest } from './setupPinSession';

import type { ReactNode } from 'react';

vi.mock('../../../../api/client', async (original) => ({
  ...await original<typeof import('../../../../api/client')>(),
  deleteInventoryDrawer: vi.fn(), deleteInventoryShelf: vi.fn(), deleteInventoryTag: vi.fn(),
  dismissInventoryImport: vi.fn(), restoreInventoryImport: vi.fn(),
  getInventoryImports: vi.fn(), getInventoryImportMessages: vi.fn(), getInventoryToolFieldValues: vi.fn(),
}));

describe('inventory setup mutations', () => {
  beforeEach(() => { vi.resetAllMocks(); clearSetupPin(); rememberSetupPin('2520'); });
  afterEach(() => { onlineManager.setOnline(true); clearSetupPin(); vi.useRealTimers(); });
  it.each([
    ['deleteDrawer', deleteInventoryDrawer], ['deleteShelf', deleteInventoryShelf], ['deleteTag', deleteInventoryTag],
    ['dismissImport', dismissInventoryImport], ['restoreImport', restoreInventoryImport],
  ] as const)('%s passes the PIN to the existing API and invalidates inventory including summaries', async (name, apiFunction) => {
    vi.mocked(apiFunction).mockResolvedValue({ id: 'target' } as never);
    const client = new QueryClient();
    client.setQueryData(['inventory-items'], []);
    client.setQueryData(['inventory-locations'], []);
    client.setQueryData(['inventory-tags'], []);
    client.setQueryData(['inventory-imports'], []);
    client.setQueryData(['inventory-imports', 'summaries'], []);
    const { result } = renderHook(() => useInventoryMutations('2520', true), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await result.current[name].mutateAsync('target'); });
    expect(apiFunction).toHaveBeenCalledWith('target', '2520');
    for (const key of [['inventory-items'], ['inventory-locations'], ['inventory-tags'], ['inventory-imports'], ['inventory-imports', 'summaries']]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
  it.each(['manual', 'expiry', '401', '403'])('does not send an offline mutation after %s lock and unlock with the same PIN', async (lock) => {
    if (lock === 'expiry') { vi.useFakeTimers({ shouldAdvanceTime: true }); rememberSetupPin('2520'); }
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result, unmount } = renderHook(() => useInventoryMutations('2520', true), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    onlineManager.setOnline(false);
    let outcome!: Promise<unknown>;
    act(() => { outcome = result.current.deleteTag.mutateAsync('old').catch((error: unknown) => error); });
    await waitFor(() => expect(result.current.deleteTag.isPaused).toBe(true));
    expect(deleteInventoryTag).not.toHaveBeenCalled();
    if (lock === 'expiry') {
      act(() => vi.advanceTimersByTime(5 * 60_000));
    } else if (lock === 'manual') act(clearSetupPin);
    else await act(async () => {
      await sendSetupRequest(captureSetupPinSession('2520'), () => Promise.reject({ response: { status: Number(lock) } })).catch(() => undefined);
    });
    expect(readSetupPin()).toBeNull();
    unmount();
    rememberSetupPin('2520');
    onlineManager.setOnline(true);
    await act(async () => { await client.resumePausedMutations(); });
    expect(await outcome).toEqual(new Error('ロックされています'));
    expect(deleteInventoryTag).not.toHaveBeenCalled();
  });

  it.each([
    [useInventoryImports, getInventoryImports],
    [useInventoryImportMessages, getInventoryImportMessages],
    [(pin: string, setup: boolean) => useInventoryToolFieldValues(pin, true, setup), getInventoryToolFieldValues],
  ] as const)('guards each setup query before sending after lock and re-unlock', async (hook, apiFunction) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiFunction).mockResolvedValue([] as never);
    const { result } = renderHook(() => hook('2520', true), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFunction).toHaveBeenCalledWith('2520');
    clearSetupPin();
    rememberSetupPin('2520');
    await act(async () => {
      await expect(result.current.refetch({ throwOnError: true })).rejects.toThrow('ロックされています');
    });
    expect(apiFunction).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('locks for each PIN-bearing setup query %s', async (status) => {
    for (const [hook, apiFunction] of [
      [() => useInventoryImports('2520', true), getInventoryImports],
      [() => useInventoryImportMessages('2520', true), getInventoryImportMessages],
      [() => useInventoryToolFieldValues('2520', true, true), getInventoryToolFieldValues],
    ] as const) {
      rememberSetupPin('2520');
      vi.mocked(apiFunction).mockRejectedValue({ response: { status } });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result, unmount } = renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(apiFunction).toHaveBeenCalledWith('2520');
      expect(readSetupPin()).toBeNull();
      unmount();
      client.clear();
    }
  });

  it.each([401, 403])('locks on a setup mutation %s even when its caller catches the error', async (status) => {
    vi.mocked(deleteInventoryTag).mockRejectedValue({ response: { status } });
    const client = new QueryClient();
    const { result } = renderHook(() => useInventoryMutations('2520', true), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await result.current.deleteTag.mutateAsync('tag').catch(() => undefined); });
    expect(readSetupPin()).toBeNull();
  });

  it('keeps setup unlocked when a normal inventory query or mutation returns 403', async () => {
    vi.mocked(getInventoryImports).mockRejectedValue({ response: { status: 403 } });
    vi.mocked(deleteInventoryTag).mockRejectedValue({ response: { status: 403 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ query: useInventoryImports('2520'), mutations: useInventoryMutations('2520') }), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    await act(async () => { await result.current.mutations.deleteTag.mutateAsync('tag').catch(() => undefined); });
    expect(getInventoryImports).toHaveBeenCalledWith('2520');
    expect(deleteInventoryTag).toHaveBeenCalledWith('tag', '2520');
    expect(readSetupPin()).toBe('2520');
  });

  it('does not lock a new session when an old in-flight request returns 403', async () => {
    let reject!: (error: unknown) => void;
    const session = captureSetupPinSession('2520');
    const outcome = sendSetupRequest(session, () => new Promise((_, fail) => { reject = fail; })).catch(() => undefined);
    clearSetupPin();
    rememberSetupPin('2520');
    reject({ response: { status: 403 } });
    await outcome;
    expect(readSetupPin()).toBe('2520');
  });

});
