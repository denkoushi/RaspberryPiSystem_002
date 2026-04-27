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
  it('posts chat completion and returns assistant text', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '  hello  ' } }],
      }),
    })) as unknown as typeof fetch;

    const router = new InferenceRouter({
      providers: [provider],
      routes: {
        photo_label: { providerId: 'default' },
        document_summary: { providerId: 'default' },
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      model: 'test-model',
      max_tokens: 100,
    });
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
        document_summary: { providerId: 'default' },
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
        document_summary: { providerId: 'default' },
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
