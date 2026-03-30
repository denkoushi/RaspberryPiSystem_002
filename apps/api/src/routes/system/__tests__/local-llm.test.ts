import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

import { buildServer } from '../../../app.js';
import { env } from '../../../config/env.js';
import { resetInferenceRuntimeForTests } from '../../../services/inference/inference-runtime.js';
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
    env.INFERENCE_PROVIDERS_JSON = undefined;
    resetInferenceRuntimeForTests();
  });

  afterAll(async () => {
    env.LOCAL_LLM_BASE_URL = originalConfig.baseUrl;
    env.LOCAL_LLM_SHARED_TOKEN = originalConfig.sharedToken;
    env.LOCAL_LLM_MODEL = originalConfig.model;
    env.LOCAL_LLM_TIMEOUT_MS = originalConfig.timeoutMs;
    resetInferenceRuntimeForTests();

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
