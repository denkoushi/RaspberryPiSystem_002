import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

import { buildServer } from '../../../app.js';
import { env } from '../../../config/env.js';
import { resetInferenceRuntimeForTests } from '../../../services/inference/inference-runtime.js';
import { resetLocalLlmRuntimeControllerForTests } from '../../../services/inference/runtime/get-local-llm-runtime-controller.js';
import { expectApiError } from '../../__tests__/helpers.js';

describe('system local llm routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let managerToken: string;
  let originalConfig: {
    baseUrl: typeof env.LOCAL_LLM_BASE_URL;
    sharedToken: typeof env.LOCAL_LLM_SHARED_TOKEN;
    model: typeof env.LOCAL_LLM_MODEL;
    timeoutMs: typeof env.LOCAL_LLM_TIMEOUT_MS;
    runtimeMode: typeof env.LOCAL_LLM_RUNTIME_MODE;
    startUrl: typeof env.LOCAL_LLM_RUNTIME_CONTROL_START_URL;
    stopUrl: typeof env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL;
    controlToken: typeof env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN;
    healthBaseUrl: typeof env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL;
  };

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
    originalConfig = {
      baseUrl: env.LOCAL_LLM_BASE_URL,
      sharedToken: env.LOCAL_LLM_SHARED_TOKEN,
      model: env.LOCAL_LLM_MODEL,
      timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
      runtimeMode: env.LOCAL_LLM_RUNTIME_MODE,
      startUrl: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
      stopUrl: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
      controlToken: env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
      healthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL,
    };
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    adminToken = createAccessToken('ADMIN');
    managerToken = createAccessToken('MANAGER');

    env.LOCAL_LLM_BASE_URL = 'http://100.107.223.92:38081';
    env.LOCAL_LLM_SHARED_TOKEN = 'test-shared-token';
    env.LOCAL_LLM_MODEL = 'Qwen_Qwen3.5-9B-Q4_K_M.gguf';
    env.LOCAL_LLM_TIMEOUT_MS = 1500;
    env.LOCAL_LLM_RUNTIME_MODE = 'always_on';
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = undefined;
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = undefined;
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = undefined;
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = undefined;
    env.INFERENCE_PROVIDERS_JSON = undefined;
    resetInferenceRuntimeForTests();
    resetLocalLlmRuntimeControllerForTests();
  });

  afterAll(async () => {
    env.LOCAL_LLM_BASE_URL = originalConfig.baseUrl;
    env.LOCAL_LLM_SHARED_TOKEN = originalConfig.sharedToken;
    env.LOCAL_LLM_MODEL = originalConfig.model;
    env.LOCAL_LLM_TIMEOUT_MS = originalConfig.timeoutMs;
    env.LOCAL_LLM_RUNTIME_MODE = originalConfig.runtimeMode;
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = originalConfig.startUrl;
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = originalConfig.stopUrl;
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = originalConfig.controlToken;
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = originalConfig.healthBaseUrl;
    resetInferenceRuntimeForTests();
    resetLocalLlmRuntimeControllerForTests();

    if (closeServer) {
      await closeServer();
    }
  });

  it('requires auth for local llm status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/system/local-llm/status',
    });

    expectApiError(response, 401, '認証トークンが必要です');
  });

  it('returns upstream health for admin or manager', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/local-llm/status',
      headers: {
        Authorization: `Bearer ${managerToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: true,
      model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
      health: {
        ok: true,
        statusCode: 200,
        body: 'ok',
      },
    });
  });

  it('proxies chat completions through Pi5 API', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: '疎通確認 OK です',
            },
          },
        ],
        usage: {
          prompt_tokens: 28,
          completion_tokens: 6,
          total_tokens: 34,
        },
      }),
    } as Response);

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: '日本語で一文だけ返答してください。',
          },
        ],
        maxTokens: 80,
        temperature: 0.2,
        enableThinking: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
      content: '疎通確認 OK です',
      finishReason: 'stop',
      usage: {
        promptTokens: 28,
        completionTokens: 6,
        totalTokens: 34,
      },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe('http://100.107.223.92:38081/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LLM-Token': 'test-shared-token',
      },
    });

    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
      max_tokens: 80,
      temperature: 0.2,
      chat_template_kwargs: {
        enable_thinking: false,
      },
    });
  });

  it('returns 503 when local llm is not configured', async () => {
    env.LOCAL_LLM_BASE_URL = undefined;
    env.LOCAL_LLM_SHARED_TOKEN = undefined;
    env.LOCAL_LLM_MODEL = undefined;

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: '疎通確認してください。',
          },
        ],
      },
    });

    expectApiError(response, 503, 'LocalLLM が設定されていません');
  });

  it('returns 502 when upstream response content is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            finish_reason: 'stop',
            message: {},
          },
        ],
      }),
    } as Response);

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [
          {
            role: 'user',
            content: '疎通確認してください。',
          },
        ],
      },
    });

    expectApiError(response, 502, 'LocalLLM の応答形式が不正です');
  });

  it('ensures runtime before chat in on_demand mode', async () => {
    env.LOCAL_LLM_RUNTIME_MODE = 'on_demand';
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = 'http://100.107.223.92:38081/start';
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = 'http://100.107.223.92:38081/stop';
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = 'runtime-control-token';
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = 'http://100.107.223.92:38081';
    resetLocalLlmRuntimeControllerForTests();

    let chatCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          return new Response('ready', { status: 200 });
        }
        return new Response(
          JSON.stringify({
            model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
            choices: [{ finish_reason: 'stop', message: { content: 'on_demand chat ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/stop') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: 'on demand chat を実行' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
      content: 'on_demand chat ok',
    });

    const calledUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.endsWith('/start'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('/v1/chat/completions'))).toBe(true);
    expect(calledUrls.some((url) => url.endsWith('/stop'))).toBe(true);
  });

  it('returns LOCAL_LLM_RUNTIME_UNAVAILABLE when runtime pre-start fails', async () => {
    env.LOCAL_LLM_RUNTIME_MODE = 'on_demand';
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = 'http://100.107.223.92:38081/start';
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = 'http://100.107.223.92:38081/stop';
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = 'runtime-control-token';
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = 'http://100.107.223.92:38081';
    resetLocalLlmRuntimeControllerForTests();

    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        return new Response('start failed', { status: 503 });
      }
      return new Response('should not reach upstream chat', { status: 500 });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: 'on demand chat を実行' }],
      },
    });

    expectApiError(response, 503, 'LocalLLM ランタイムの起動に失敗しました');
    expect(response.json()).toMatchObject({
      errorCode: 'LOCAL_LLM_RUNTIME_UNAVAILABLE',
    });
    const calledUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('/v1/chat/completions'))).toBe(false);
  });

  it('returns LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED when on_demand but control endpoints are incomplete', async () => {
    env.LOCAL_LLM_RUNTIME_MODE = 'on_demand';
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = undefined;
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = undefined;
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = undefined;
    resetLocalLlmRuntimeControllerForTests();

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/local-llm/chat/completions',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: 'test' }],
      },
    });

    expectApiError(response, 503, 'LocalLLM はオンデマンド運用ですが、起動制御の設定が不完全です');
    expect(response.json()).toMatchObject({
      errorCode: 'LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED',
    });
  });
});

function createAccessToken(role: 'ADMIN' | 'MANAGER'): string {
  return jwt.sign(
    {
      sub: `test-${role.toLowerCase()}`,
      username: `test-${role.toLowerCase()}`,
      role,
    },
    env.JWT_ACCESS_SECRET
  );
}
