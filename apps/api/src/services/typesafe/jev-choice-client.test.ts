import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestJevChoice } from './jev-choice-client.js';

const input = { apiKey: 'test-placeholder', timeoutMs: 20000,
  state: { item: 'test' }, instructions: 'choose', criteria: { c1: 'one', none: 'none' }, assets: {} };
afterEach(() => { vi.useRealTimers(); });

describe('JEV choice client bounds', () => {
  it.each(['fetch', 'json'])('bounds stalled %s at the configured deadline', async (stage) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (stage === 'fetch') return new Promise<Response>(() => {});
      return { ok: true, json: () => new Promise(() => {}) } as Response;
    });
    const request = requestJevChoice({ ...input, fetch: fetchMock });
    const assertion = expect(request).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(19999);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on success and returns only validated probabilities', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { q: {
      choice: 'none', probabilities: { c1: 0.4, none: 0.6 }
    } } })));
    expect(await requestJevChoice({ ...input, fetch: fetchMock })).toEqual({ c1: 0.4, none: 0.6 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, null, undefined])('rejects a non-finite or absent probability %s', async (value) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ answers: { q: { probabilities: { c1: value, none: 0 } } } }) }) as Response);
    await expect(requestJevChoice({ ...input, fetch: fetchMock })).rejects.toThrow('Invalid JEV probability');
  });
});
