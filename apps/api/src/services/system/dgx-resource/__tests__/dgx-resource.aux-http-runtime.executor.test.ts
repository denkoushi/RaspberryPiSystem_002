import { describe, expect, it, vi } from 'vitest';

import { executeAuxHttpRuntimeStartStop } from '../dgx-resource.aux-http-runtime.executor.js';

describe('executeAuxHttpRuntimeStartStop', () => {
  it('POSTs start URL with X-Runtime-Control-Token when token provided', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        url: '',
        text: async () => '',
        json: async () => ({}),
      } as Response;
    });

    await executeAuxHttpRuntimeStartStop(
      { fetchImpl },
      {
        action: 'start',
        startUrl: 'http://127.0.0.1:9191/aux-start',
        stopUrl: 'http://127.0.0.1:9191/aux-stop',
        timeoutMs: 5000,
        controlToken: 'tok-xxx',
        reason: 'unit',
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const hdrs = new Headers(init?.headers as HeadersInit | undefined);
    expect(hdrs.get('X-Runtime-Control-Token')).toBe('tok-xxx');
    expect(init?.method).toBe('POST');
  });

  it('POSTs stop URL without token header when omitted', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        url: '',
        text: async () => '',
        json: async () => ({}),
      } as Response;
    });

    await executeAuxHttpRuntimeStartStop(
      { fetchImpl },
      {
        action: 'stop',
        startUrl: 'http://127.0.0.1:1/a',
        stopUrl: 'http://127.0.0.1:1/b',
        timeoutMs: 3000,
      }
    );

    expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:1/b');
  });
});
