import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

import { buildServer } from '../../../app.js';
import { env } from '../../../config/env.js';
import { resetInferenceRuntimeForTests } from '../../../services/inference/inference-runtime.js';
import { resetLocalLlmRuntimeControllerForTests } from '../../../services/inference/runtime/get-local-llm-runtime-controller.js';
import { STACKCHAN_DETAIL_SYSTEM_PROMPT_JA } from '../../../services/system/stackchan-chat-request.js';
import { expectApiError } from '../../__tests__/helpers.js';

describe('system stackchan routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;
  let managerToken: string;
  let originalConfig: {
    baseUrl: typeof env.LOCAL_LLM_BASE_URL;
    sharedToken: typeof env.LOCAL_LLM_SHARED_TOKEN;
    model: typeof env.LOCAL_LLM_MODEL;
    adminProviderId: typeof env.INFERENCE_ADMIN_PROVIDER_ID;
    timeoutMs: typeof env.LOCAL_LLM_TIMEOUT_MS;
    runtimeMode: typeof env.LOCAL_LLM_RUNTIME_MODE;
    startUrl: typeof env.LOCAL_LLM_RUNTIME_CONTROL_START_URL;
    stopUrl: typeof env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL;
    controlToken: typeof env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN;
    healthBaseUrl: typeof env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL;
    inferenceProvidersJson: typeof env.INFERENCE_PROVIDERS_JSON;
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
      adminProviderId: env.INFERENCE_ADMIN_PROVIDER_ID,
      timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
      runtimeMode: env.LOCAL_LLM_RUNTIME_MODE,
      startUrl: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
      stopUrl: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
      controlToken: env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
      healthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL,
      inferenceProvidersJson: env.INFERENCE_PROVIDERS_JSON,
    };
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    adminToken = jwt.sign({ sub: 'test-admin', username: 'test-admin', role: 'ADMIN' }, env.JWT_ACCESS_SECRET);
    managerToken = jwt.sign(
      { sub: 'test-manager', username: 'test-manager', role: 'MANAGER' },
      env.JWT_ACCESS_SECRET
    );

    env.LOCAL_LLM_BASE_URL = 'http://100.107.223.92:38081';
    env.LOCAL_LLM_SHARED_TOKEN = 'test-shared-token';
    env.LOCAL_LLM_MODEL = 'system-prod-primary';
    env.INFERENCE_ADMIN_PROVIDER_ID = 'default';
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
    env.INFERENCE_ADMIN_PROVIDER_ID = originalConfig.adminProviderId;
    env.LOCAL_LLM_TIMEOUT_MS = originalConfig.timeoutMs;
    env.LOCAL_LLM_RUNTIME_MODE = originalConfig.runtimeMode;
    env.LOCAL_LLM_RUNTIME_CONTROL_START_URL = originalConfig.startUrl;
    env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL = originalConfig.stopUrl;
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN = originalConfig.controlToken;
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL = originalConfig.healthBaseUrl;
    env.INFERENCE_PROVIDERS_JSON = originalConfig.inferenceProvidersJson;
    resetInferenceRuntimeForTests();
    resetLocalLlmRuntimeControllerForTests();

    if (closeServer) {
      await closeServer();
    }
  });

  it('requires auth for stackchan chat', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/system/stackchan/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });

    expectApiError(response, 401, '認証トークンが必要です');
  });

  it('allows manager role for stackchan chat', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'system-prod-primary',
        choices: [{ finish_reason: 'stop', message: { content: 'manager ok' } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      }),
    } as Response);

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/stackchan/chat',
      headers: {
        Authorization: `Bearer ${managerToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: '権限確認' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ content: 'manager ok' });
  });

  it('merges detail system prompt and applies StackChan defaults to upstream', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'system-prod-primary',
        choices: [{ finish_reason: 'stop', message: { content: '詳説応答' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    } as Response);

    const response = await app.inject({
      method: 'POST',
      url: '/api/system/stackchan/chat',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: '説明してください' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'system-prod-primary',
      content: '詳説応答',
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    const payload = JSON.parse(String(init?.body));
    expect(payload.max_tokens).toBe(1536);
    expect(payload.temperature).toBe(0.35);
    expect(payload.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(payload.messages[0].role).toBe('system');
    expect(String(payload.messages[0].content)).toContain(STACKCHAN_DETAIL_SYSTEM_PROMPT_JA);
    expect(payload.messages[1]).toEqual({ role: 'user', content: '説明してください' });
  });

  it('ensures runtime before stackchan chat in on_demand mode', async () => {
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
            model: 'system-prod-primary',
            choices: [{ finish_reason: 'stop', message: { content: 'stackchan ok' } }],
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
      url: '/api/system/stackchan/chat',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      payload: {
        messages: [{ role: 'user', content: 'テスト' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ content: 'stackchan ok' });

    const calledUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.endsWith('/start'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('/v1/chat/completions'))).toBe(true);
    expect(calledUrls.some((url) => url.endsWith('/stop'))).toBe(false);
  });
});
