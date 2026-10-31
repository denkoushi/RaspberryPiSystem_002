import { describe, expect, it, vi } from 'vitest';

import type { InferenceProviderDefinition } from '../../config/inference-provider.types.js';
import { InferenceRouter } from '../../routing/inference-router.js';
import { OpenAiCompatibleTextAdapter } from '../openai-compatible-text.adapter.js';

const provider: InferenceProviderDefinition = {
  id: 'default',
  baseUrl: 'http://127.0.0.1:9',
  sharedToken: 'secret',
  timeoutMs: 5000,
  defaultModel: 'test-model',
};

describe('OpenAiCompatibleTextAdapter', () => {
  it.each(['business_hermes', 'security_review'] as const)('sends the background alias and defers without replay for %s', async useCase => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const router = new InferenceRouter({ providers: [{ ...provider, defaultModel: 'system-prod-primary' }],
      routes: { photo_label: { providerId: 'default' }, business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' }, document_summary: { providerId: 'default' }, admin_console_chat: { providerId: 'default' } } });
    const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
    await expect(adapter.complete({ useCase, messages: [], maxTokens: 10,
      temperature: 0, enableThinking: false, background: true })).rejects.toMatchObject({ name: 'InferenceDeferredError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ model: 'dgx-background-preparation' });
  });
  it.each(['adapter', 'service'] as const)('normalizes the %s timeout to TimeoutError', async source => {
    vi.useFakeTimers();
    try {
      const router = new InferenceRouter({ providers: [provider], routes: {
        photo_label: { providerId: 'default' }, business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' }, document_summary: { providerId: 'default' },
        admin_console_chat: { providerId: 'default' },
      } });
      const controller = new AbortController();
      const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
      })) as unknown as typeof fetch;
      const call = new OpenAiCompatibleTextAdapter({ router, fetchImpl }).complete({ useCase: 'security_review',
        messages: [], maxTokens: 100, temperature: 0, enableThinking: false, signal: controller.signal });
      const check = expect(call).rejects.toMatchObject({ name: 'TimeoutError' });
      if (source === 'service') controller.abort(new DOMException('deadline', 'TimeoutError'));
      else await vi.advanceTimersByTimeAsync(provider.timeoutMs);
      await check;
    } finally { vi.useRealTimers(); }
  });

  it('posts chat completion and returns assistant text', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '  hello  ' }, finish_reason: 'stop' }],
      }),
    })) as unknown as typeof fetch;

    const router = new InferenceRouter({
      providers: [provider],
      routes: {
        photo_label: { providerId: 'default' },
        business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' },
        document_summary: { providerId: 'default' },
        admin_console_chat: { providerId: 'default' },
      },
    });

    const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
    const result = await adapter.complete({
      useCase: 'document_summary',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 100,
      temperature: 0.1,
      enableThinking: false,
    });

    expect(result.rawText).toBe('hello');
    expect(result.model).toBe('test-model');
    expect(result.finishReason).toBe('stop');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'test-model',
      max_tokens: 100,
    });
  });

  it.each(['{"findings":', ''])('returns length even for truncated or empty assistant text', async content => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content }, finish_reason: 'length' }],
    }) });
    const router = new InferenceRouter({ providers: [provider], routes: {
      photo_label: { providerId: 'default' }, business_hermes: { providerId: 'default' },
      security_review: { providerId: 'default' }, document_summary: { providerId: 'default' },
      admin_console_chat: { providerId: 'default' },
    } });
    const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
    await expect(adapter.complete({ useCase: 'security_review', messages: [], maxTokens: 2000,
      temperature: 0, enableThinking: false })).resolves.toEqual({
      rawText: content, model: 'test-model', finishReason: 'length',
    });
  });

  it('preserves the missing-text failure for other uses even when length-truncated', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
    }) });
    const router = new InferenceRouter({ providers: [provider], routes: {
      photo_label: { providerId: 'default' }, business_hermes: { providerId: 'default' },
      security_review: { providerId: 'default' }, document_summary: { providerId: 'default' },
      admin_console_chat: { providerId: 'default' },
    } });
    await expect(new OpenAiCompatibleTextAdapter({ router, fetchImpl }).complete({
      useCase: 'document_summary', messages: [], maxTokens: 100, temperature: 0, enableThinking: false,
    })).rejects.toThrow('missing assistant text');
  });

  it('uses a request timeout override and preserves the provider timeout for other requests', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise((resolve) => {
        init!.signal!.addEventListener('abort', () => resolve({ ok: false, status: 504 }));
      })) as unknown as typeof fetch;
      const router = new InferenceRouter({ providers: [provider], routes: {
        photo_label: { providerId: 'default' }, business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' }, document_summary: { providerId: 'default' },
        admin_console_chat: { providerId: 'default' },
      } });
      const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
      const request = { messages: [], maxTokens: 100, temperature: 0, enableThinking: false };
      const overridden = adapter.complete({ ...request, useCase: 'security_review', timeoutMs: 120_000 });
      const overriddenCheck = expect(overridden).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(provider.timeoutMs);
      expect((fetchImpl.mock.calls[0]![1] as RequestInit).signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(120_000 - provider.timeoutMs);
      await overriddenCheck;

      const normal = adapter.complete({ ...request, useCase: 'document_summary' });
      const normalCheck = expect(normal).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(provider.timeoutMs - 1);
      expect((fetchImpl.mock.calls[1]![1] as RequestInit).signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await normalCheck;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses reasoning when assistant content is empty (vLLM / Qwen系)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '', reasoning: 'フォールバック本文' } }],
      }),
    })) as unknown as typeof fetch;

    const router = new InferenceRouter({
      providers: [provider],
      routes: {
        photo_label: { providerId: 'default' },
        business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' },
        document_summary: { providerId: 'default' },
        admin_console_chat: { providerId: 'default' },
      },
    });

    const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
    const result = await adapter.complete({
      useCase: 'document_summary',
      messages: [{ role: 'user', content: 'a' }],
      maxTokens: 10,
      temperature: 0,
      enableThinking: false,
    });

    expect(result.rawText).toBe('フォールバック本文');
  });

  it('throws on upstream error', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const router = new InferenceRouter({
      providers: [provider],
      routes: {
        photo_label: { providerId: 'default' },
        business_hermes: { providerId: 'default' },
        security_review: { providerId: 'default' },
        document_summary: { providerId: 'default' },
        admin_console_chat: { providerId: 'default' },
      },
    });

    const adapter = new OpenAiCompatibleTextAdapter({ router, fetchImpl });
    await expect(
      adapter.complete({
        useCase: 'document_summary',
        messages: [{ role: 'user', content: 'a' }],
        maxTokens: 10,
        temperature: 0,
        enableThinking: false,
      })
    ).rejects.toThrow(/502/);
  });
});
