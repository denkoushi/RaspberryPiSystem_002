import { describe, expect, it, vi } from 'vitest';

import {
  isDeployableNfcRuntime,
  isHealthyNfcAgentStatus,
  proveNfcRuntimeReady,
  type NfcRuntimeContract
} from './nfcRuntimeContract';

const localContract: NfcRuntimeContract = {
  policy: 'localOnly',
  streamUrls: ['ws://localhost:7071/stream'],
  statusUrl: 'http://127.0.0.1:7071/api/agent/status'
};

const response = (body: unknown, ok = true) =>
  ({
    ok,
    json: vi.fn().mockResolvedValue(body)
  }) as unknown as Response;

describe('NfcRuntimeContract', () => {
  it('accepts only connected reader with an empty queue', () => {
    expect(isHealthyNfcAgentStatus({ readerConnected: true, queueSize: 0 })).toBe(true);
    expect(isHealthyNfcAgentStatus({ readerConnected: false, queueSize: 0 })).toBe(false);
    expect(isHealthyNfcAgentStatus({ readerConnected: true, queueSize: 1 })).toBe(false);
    expect(isHealthyNfcAgentStatus({ readerConnected: true, queueSize: '0' })).toBe(false);
  });

  it('requires local-only policy and exactly one loopback stream', () => {
    expect(isDeployableNfcRuntime(localContract)).toBe(true);
    expect(isDeployableNfcRuntime({ ...localContract, policy: 'legacy' })).toBe(false);
    expect(
      isDeployableNfcRuntime({
        ...localContract,
        streamUrls: ['ws://100.64.0.1:7071/stream']
      })
    ).toBe(false);
  });

  it('requires two consecutive one-second samples', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ readerConnected: true, queueSize: 0 }));
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(proveNfcRuntimeReady(localContract, { fetcher, wait })).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it.each([
    ['reader disconnected', { readerConnected: false, queueSize: 0 }],
    ['queue backlog', { readerConnected: true, queueSize: 1 }],
    ['malformed', { readerConnected: true }],
  ])('rejects %s', async (_name, body) => {
    const fetcher = vi.fn().mockResolvedValue(response(body));
    await expect(
      proveNfcRuntimeReady(localContract, {
        fetcher,
        wait: async () => undefined
      })
    ).resolves.toBe(false);
  });

  it('handles endpoint timeout and cancellation without evidence', async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException('timeout', 'AbortError'));
    await expect(proveNfcRuntimeReady(localContract, { fetcher })).resolves.toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(
      proveNfcRuntimeReady(localContract, {
        fetcher: vi.fn(),
        signal: controller.signal
      })
    ).resolves.toBe(false);
  });
});
