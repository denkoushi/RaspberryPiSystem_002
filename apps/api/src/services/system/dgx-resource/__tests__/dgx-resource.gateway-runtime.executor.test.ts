import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../config/env.js', () => ({
  env: {
    LOCAL_LLM_RUNTIME_MODE: 'on_demand',
    LOCAL_LLM_RUNTIME_CONTROL_START_URL: 'http://127.0.0.1/start',
    LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: 'http://127.0.0.1/stop',
    LOCAL_LLM_RUNTIME_CONTROL_TOKEN: 'control-token-xxxxxxxxxxxxxxxxxxxxxxxx',
    LOCAL_LLM_SHARED_TOKEN: '',
    LOCAL_LLM_RUNTIME_START_REQUEST_TIMEOUT_MS: 5000,
    LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS: 5000,
  },
}));

import { executeGatewayRuntimeStartStop } from '../dgx-resource.gateway-runtime.executor.js';

describe('executeGatewayRuntimeStartStop', () => {
  it('POSTs to start URL with runtime token header', async () => {
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

    await executeGatewayRuntimeStartStop({ fetchImpl }, 'start', 'unit_test');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1/start');
    expect(init?.method).toBe('POST');
    expect(JSON.stringify(init?.headers)).toContain('control-token');
  });

  it('POSTs to stop URL', async () => {
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

    await executeGatewayRuntimeStartStop({ fetchImpl }, 'stop');

    expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1/stop');
  });
});
