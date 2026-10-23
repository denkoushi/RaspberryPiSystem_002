import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLocalLlmAvailability } from '../domains/system';
import { api } from '../http';

import { useLocalLlmAvailability } from './local-llm';

import type { PropsWithChildren } from 'react';

vi.mock('../http', () => ({ api: { get: vi.fn() } }));
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { client = new QueryClient(); vi.mocked(api.get).mockReset(); });
afterEach(() => { client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); });

describe('local LLM availability', () => {
  it('uses the read-only client route and a 5 second timeout', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { available: false } });
    const signal = new AbortController().signal;
    expect(await getLocalLlmAvailability(signal)).toEqual({ available: false });
    expect(api.get).toHaveBeenCalledWith('/system/local-llm/availability', { timeout: 5000, signal, kioskTelemetry: 'background' });
  });

  it('shares a query and only marks a confirmed unavailable response', async () => {
    let resolve!: (value: { data: { available: boolean } }) => void;
    vi.mocked(api.get).mockReturnValue(new Promise(done => { resolve = done; }));
    const first = renderHook(useLocalLlmAvailability, { wrapper: Wrapper });
    const second = renderHook(useLocalLlmAvailability, { wrapper: Wrapper });
    expect(first.result.current.unavailable).toBe(false);
    expect(second.result.current.unavailable).toBe(false);
    await act(async () => resolve({ data: { available: false } }));
    await waitFor(() => expect(first.result.current.unavailable).toBe(true));
    expect(second.result.current.unavailable).toBe(true);
    expect(api.get).toHaveBeenCalledOnce();
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    await act(async () => { await client.refetchQueries({ queryKey: ['local-llm-availability'] }); });
    await waitFor(() => expect(first.result.current.unavailable).toBe(false));
  });

  it('does not mark a healthy response or initial request error', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { available: true } });
    const { result } = renderHook(useLocalLlmAvailability, { wrapper: Wrapper });
    await waitFor(() => expect(client.getQueryState(['local-llm-availability'])?.status).toBe('success'));
    expect(result.current.unavailable).toBe(false);
    client.clear();
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const error = renderHook(useLocalLlmAvailability, { wrapper: Wrapper });
    await waitFor(() => expect(client.getQueryState(['local-llm-availability'])?.status).toBe('error'));
    expect(error.result.current.unavailable).toBe(false);
  });

  it('polls every 30 seconds and refetches on window focus', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue({ data: { available: true } });
    renderHook(useLocalLlmAvailability, { wrapper: Wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.get).toHaveBeenCalledTimes(2);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(api.get).toHaveBeenCalledTimes(3);
  });
});
