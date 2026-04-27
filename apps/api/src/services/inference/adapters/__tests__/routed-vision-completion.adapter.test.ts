import { describe, expect, it, vi } from 'vitest';

import type { InferenceProviderDefinition } from '../../config/inference-provider.types.js';
import { InferenceRouter } from '../../routing/inference-router.js';
import { RoutedVisionCompletionAdapter } from '../routed-vision-completion.adapter.js';

const provider: InferenceProviderDefinition = {
  id: 'default',
  baseUrl: 'http://127.0.0.1:9',
  sharedToken: 'secret',
  timeoutMs: 5000,
  defaultModel: 'test-model',
};

const baseRouter = () =>
  new InferenceRouter({
    providers: [provider],
    routes: {
      photo_label: { providerId: 'default' },
      document_summary: { providerId: 'default' },
    },
  });

describe('RoutedVisionCompletionAdapter', () => {
  it('returns assistant text on 200', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '  ドリル  ' } }],
      }),
    })) as unknown as typeof fetch;

    const adapter = new RoutedVisionCompletionAdapter({
      router: baseRouter(),
      fetchImpl,
      useCase: 'photo_label',
      getMaxTokens: () => 100,
      getTemperature: () => 0.1,
    });

    const out = await adapter.complete({
      imageBytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      userText: '何の工具？',
    });

    expect(out.rawText).toBe('ドリル');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries once on image load/decode 400 with reencode then succeeds', async () => {
    const reencode = vi.fn(async () => Buffer.from('jpeg-bytes'));
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => 'Failed to load image: cannot identify image file',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '再送後の応答' } }],
        }),
      };
    }) as unknown as typeof fetch;

    const adapter = new RoutedVisionCompletionAdapter({
      router: baseRouter(),
      fetchImpl,
      useCase: 'photo_label',
      getMaxTokens: () => 100,
      getTemperature: () => 0.1,
      reencodeImageBufferForVlmFallback: reencode,
    });

    const out = await adapter.complete({
      imageBytes: Buffer.from([1, 2, 3]),
      mimeType: 'image/jpeg',
      userText: 'test',
    });

    expect(reencode).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.rawText).toBe('再送後の応答');
  });

  it('does not retry on non-decode 400', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'some other client error',
    })) as unknown as typeof fetch;

    const adapter = new RoutedVisionCompletionAdapter({
      router: baseRouter(),
      fetchImpl,
      useCase: 'photo_label',
      getMaxTokens: () => 100,
      getTemperature: () => 0.1,
    });

    await expect(
      adapter.complete({
        imageBytes: Buffer.from([1]),
        mimeType: 'image/jpeg',
        userText: 't',
      })
    ).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 502', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    })) as unknown as typeof fetch;

    const adapter = new RoutedVisionCompletionAdapter({
      router: baseRouter(),
      fetchImpl,
      useCase: 'photo_label',
      getMaxTokens: () => 100,
      getTemperature: () => 0.1,
    });

    await expect(
      adapter.complete({
        imageBytes: Buffer.from([1]),
        mimeType: 'image/jpeg',
        userText: 't',
      })
    ).rejects.toThrow(/502/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses reasoning when content is empty', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '', reasoning: 'ラベル推論' } }],
      }),
    })) as unknown as typeof fetch;

    const adapter = new RoutedVisionCompletionAdapter({
      router: baseRouter(),
      fetchImpl,
      useCase: 'photo_label',
      getMaxTokens: () => 100,
      getTemperature: () => 0.1,
    });

    const out = await adapter.complete({
      imageBytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      userText: 'x',
    });
    expect(out.rawText).toBe('ラベル推論');
  });
});
