import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../config/env/load-dotenv.js', () => ({}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';

import { env } from '../../../../config/env.js';

const enabled = env.PHOTO_TOOL_EMBEDDING_ENABLED;
beforeEach(() => { vi.resetModules(); env.PHOTO_TOOL_EMBEDDING_ENABLED = true; });
afterEach(() => { env.PHOTO_TOOL_EMBEDDING_ENABLED = enabled; vi.useRealTimers(); vi.clearAllMocks(); });

async function modules() {
  // Both imports share the same fresh health store and environment module.
  const { env: freshEnv } = await import('../../../../config/env.js');
  freshEnv.PHOTO_TOOL_EMBEDDING_ENABLED = true;
  const health = await import('../photo-tool-embedding-health.js');
  const { HttpPhotoToolImageEmbeddingAdapter } = await import('../http-photo-tool-image-embedding.adapter.js');
  return { ...health, freshEnv, adapter: new HttpPhotoToolImageEmbeddingAdapter({ url: 'http://embedding.test', timeoutMs: 100, expectedDim: 2 }) };
}

describe('observed photo embedding health', () => {
  it('starts not observed and reports disabled without a probe', async () => {
    const test = await modules();
    expect(test.readPhotoToolEmbeddingHealth()).toEqual({ state: 'not_observed', lastSuccessAt: null, lastFailureAt: null, lastErrorBrief: null });
    test.freshEnv.PHOTO_TOOL_EMBEDDING_ENABLED = false;
    expect(test.readPhotoToolEmbeddingHealth().state).toBe('disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('records actual success → failure → success, including results in the same millisecond', async () => {
    const test = await modules();
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ embedding: [0.1, 0.2] })) as never);
    await expect(test.adapter.embedJpeg(Buffer.from('jpeg'))).resolves.toEqual([0.1, 0.2]);
    const success = test.readPhotoToolEmbeddingHealth();
    expect(success.state).toBe('ok');
    vi.mocked(fetch).mockRejectedValue(new Error('http://secret.test?key=secret'));
    await expect(test.adapter.embedJpeg(Buffer.from('jpeg'))).rejects.toThrow('secret');
    const failure = test.readPhotoToolEmbeddingHealth();
    expect(failure.state).toBe('failed');
    expect(failure.lastSuccessAt).toBe(success.lastSuccessAt);
    expect(failure.lastErrorBrief).toBe('写真の処理先に接続できませんでした');
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ embedding: [0.2, 0.3] })) as never);
    await expect(test.adapter.embedJpeg(Buffer.from('jpeg'))).resolves.toEqual([0.2, 0.3]);
    expect(test.readPhotoToolEmbeddingHealth()).toMatchObject({ state: 'ok', lastFailureAt: failure.lastFailureAt });
    test.freshEnv.PHOTO_TOOL_EMBEDDING_ENABLED = false;
    expect(test.readPhotoToolEmbeddingHealth().state).toBe('disabled');
  });
  it.each([
    ['http', new Response('secret', { status: 500 }), '写真の処理先でエラーが起きました'],
    ['dimension', new Response(JSON.stringify({ embedding: [1] })), '写真の処理結果を読み取れませんでした'],
    ['numbers', new Response(JSON.stringify({ embedding: [1, 'bad'] })), '写真の処理結果を読み取れませんでした'],
  ])('records a safe %s failure and preserves rejection', async (_name, response, expected) => {
    const test = await modules();
    vi.mocked(fetch).mockResolvedValue(response as never);
    await expect(test.adapter.embedJpeg(Buffer.from('jpeg'))).rejects.toThrow();
    expect(test.readPhotoToolEmbeddingHealth()).toMatchObject({ state: 'failed', lastErrorBrief: expected });
  });
  it('records timeout without changing the timeout behavior', async () => {
    const test = await modules(); vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = expect(test.adapter.embedJpeg(Buffer.from('jpeg'))).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(test.readPhotoToolEmbeddingHealth().lastErrorBrief).toBe('写真の処理が時間内に終わりませんでした');
  });
});
