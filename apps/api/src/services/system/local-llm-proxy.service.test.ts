import { describe, expect, it, vi } from 'vitest';

import { createLocalLlmGateway } from './local-llm-proxy.service.js';
import type { LocalLlmObservability } from './local-llm-observability.js';

const fullConfig = () => ({
  configured: true as const,
  baseUrl: 'http://100.107.223.92:38081',
  sharedToken: 'test-shared-token',
  model: 'test-model.gguf',
  timeoutMs: 5000,
});

describe('createLocalLlmGateway + observability', () => {
  function makeObsSpies(): {
    observability: LocalLlmObservability;
    healthSpy: ReturnType<typeof vi.fn>;
    chatSpy: ReturnType<typeof vi.fn>;
  } {
    const healthSpy = vi.fn();
    const chatSpy = vi.fn();
    return {
      observability: {
        emitHealthCheckOutcome: healthSpy,
        emitChatCompletionOutcome: chatSpy,
      },
      healthSpy,
      chatSpy,
    };
  }

  it('emits not_configured when health check and LocalLLM is not configured', async () => {
    const { observability, healthSpy, chatSpy } = makeObsSpies();
    const gw = createLocalLlmGateway({
      getConfig: () => ({
        configured: false,
        baseUrl: undefined,
        sharedToken: undefined,
        model: undefined,
        timeoutMs: 1000,
      }),
      fetchImpl: vi.fn(),
      observability,
    });

    await gw.getStatus();

    expect(healthSpy).toHaveBeenCalledTimes(1);
    expect(healthSpy.mock.calls[0][0]).toMatchObject({
      result: 'not_configured',
      configured: false,
      ok: false,
    });
    expect(healthSpy.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('emits ok when health check succeeds', async () => {
    const { observability, healthSpy } = makeObsSpies();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    const status = await gw.getStatus();

    expect(status.health.ok).toBe(true);
    expect(healthSpy).toHaveBeenCalledTimes(1);
    expect(healthSpy.mock.calls[0][0]).toMatchObject({
      result: 'ok',
      configured: true,
      ok: true,
      statusCode: 200,
    });
  });

  it('emits upstream_non_ok when health returns non-2xx', async () => {
    const { observability, healthSpy } = makeObsSpies();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    } as Response);

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    await gw.getStatus();

    expect(healthSpy.mock.calls[0][0]).toMatchObject({
      result: 'upstream_non_ok',
      configured: true,
      ok: false,
      statusCode: 503,
    });
  });

  it('emits fetch_error when health fetch throws', async () => {
    const { observability, healthSpy } = makeObsSpies();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    await gw.getStatus();

    expect(healthSpy.mock.calls[0][0]).toMatchObject({
      result: 'fetch_error',
      configured: true,
      ok: false,
    });
  });

  it('emits chat success with usage', async () => {
    const { observability, chatSpy } = makeObsSpies();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'test-model.gguf',
        choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    } as Response);

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    const result = await gw.createChatCompletion({
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 100,
      temperature: 0.1,
      enableThinking: false,
    });

    expect(result.content).toBe('hi');
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(chatSpy.mock.calls[0][0]).toMatchObject({
      ok: true,
      messageCount: 1,
      maxTokens: 100,
      temperature: 0.1,
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
    });
    expect(chatSpy.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits chat failure with LOCAL_LLM_UPSTREAM_ERROR on upstream 4xx/5xx body', async () => {
    const { observability, chatSpy } = makeObsSpies();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'denied',
    } as Response);

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    await expect(
      gw.createChatCompletion({
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 10,
        temperature: 0,
        enableThinking: false,
      })
    ).rejects.toMatchObject({ code: 'LOCAL_LLM_UPSTREAM_ERROR' });

    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(chatSpy.mock.calls[0][0]).toMatchObject({
      ok: false,
      errorCode: 'LOCAL_LLM_UPSTREAM_ERROR',
    });
  });

  it('emits chat failure with LOCAL_LLM_TIMEOUT on AbortError', async () => {
    const { observability, chatSpy } = makeObsSpies();
    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);

    const gw = createLocalLlmGateway({
      getConfig: fullConfig,
      fetchImpl,
      observability,
    });

    await expect(
      gw.createChatCompletion({
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 10,
        temperature: 0,
        enableThinking: false,
      })
    ).rejects.toMatchObject({ code: 'LOCAL_LLM_TIMEOUT' });

    expect(chatSpy.mock.calls[0][0]).toMatchObject({
      ok: false,
      errorCode: 'LOCAL_LLM_TIMEOUT',
    });
  });

  it('emits chat failure with LOCAL_LLM_NOT_CONFIGURED when not configured', async () => {
    const { observability, chatSpy } = makeObsSpies();
    const gw = createLocalLlmGateway({
      getConfig: () => ({
        configured: false,
        baseUrl: undefined,
        sharedToken: undefined,
        model: undefined,
        timeoutMs: 1000,
      }),
      fetchImpl: vi.fn(),
      observability,
    });

    await expect(
      gw.createChatCompletion({
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 10,
        temperature: 0,
        enableThinking: false,
      })
    ).rejects.toMatchObject({ code: 'LOCAL_LLM_NOT_CONFIGURED' });

    expect(chatSpy.mock.calls[0][0]).toMatchObject({
      ok: false,
      errorCode: 'LOCAL_LLM_NOT_CONFIGURED',
    });
  });
});
