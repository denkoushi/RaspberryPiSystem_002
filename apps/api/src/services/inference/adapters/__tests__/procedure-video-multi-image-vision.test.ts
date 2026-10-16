import { afterEach, describe, expect, it, vi } from 'vitest';

import { InferenceUnavailableError } from '../../ports/multi-image-vision-completion.port.js';
import { InferenceRouter } from '../../routing/inference-router.js';
import { RoutedVisionCompletionAdapter } from '../routed-vision-completion.adapter.js';

function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"scenes":[]}' } }] })));
  const router = new InferenceRouter({ providers: [{ id: 'business', baseUrl: 'http://localhost:1234', sharedToken: 'test-token', defaultModel: 'system-prod-primary', timeoutMs: 1000 }], routes: {
    photo_label: { providerId: 'business' }, business_hermes: { providerId: 'business' }, document_summary: { providerId: 'business' }, admin_console_chat: { providerId: 'business' }, stackchan_chat: { providerId: 'business' },
  } });
  return { fetch, adapter: new RoutedVisionCompletionAdapter({ router, fetchImpl: fetch, useCase: 'photo_label', getMaxTokens: () => 1500, getTemperature: () => 0 }) };
}
const input = { userText: '映像から字幕', images: [0, 1].map((time) => ({ label: `${time}秒`, imageBytes: Buffer.from(`jpeg${time}`), mimeType: 'image/jpeg' as const })), background: true, temperature: 0, timeoutMs: 120000, jsonOutput: true };
afterEach(() => vi.useRealTimers());
describe('procedure-video multi image inference', () => {
  it('sends all labelled images in one call through the existing photo_label provider', async () => {
    const h = setup(); const result = await h.adapter.completeMany(input);
    expect(result).toEqual({ rawText: '{"scenes":[]}', modelRoute: 'photo_label:business', modelName: 'dgx-background-preparation' });
    expect(h.fetch).toHaveBeenCalledOnce(); expect(String(h.fetch.mock.calls[0][0])).toBe('http://localhost:1234/v1/chat/completions');
    const body = JSON.parse(h.fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ model: 'dgx-background-preparation', temperature: 0, max_tokens: 1500, chat_template_kwargs: { enable_thinking: false }, response_format: { type: 'json_object' } });
    expect(body.messages[0].content.map((item: any) => item.type)).toEqual(['text', 'text', 'image_url', 'text', 'image_url']);
    expect(body.messages[0].content[1].text).toBe('0秒'); expect(body.messages[0].content[3].text).toBe('1秒');
  });
  it.each([429, 502, 503, 504])('classifies HTTP %s as unavailable without consuming an attempt', async (status) => {
    const h = setup(); h.fetch.mockResolvedValue(new Response('', { status }));
    await expect(h.adapter.completeMany(input)).rejects.toBeInstanceOf(InferenceUnavailableError);
  });
  it('classifies connection failures as unavailable', async () => {
    const h = setup(); h.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(h.adapter.completeMany(input)).rejects.toBeInstanceOf(InferenceUnavailableError);
  });
  it('keeps invalid response and HTTP 400 as ordinary failures', async () => {
    const h = setup(); h.fetch.mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('', { status: 400 }));
    await expect(h.adapter.completeMany(input)).rejects.toThrow('missing assistant text');
    await expect(h.adapter.completeMany(input)).rejects.toThrow('HTTP 400');
  });
  it('honors the 120-second timeout and caller cancellation', async () => {
    vi.useFakeTimers(); const h = setup();
    h.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))); }));
    const task = h.adapter.completeMany(input); const assertion = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(120000); await assertion;
    const controller = new AbortController(); const second = h.adapter.completeMany({ ...input, signal: controller.signal });
    const cancelled = expect(second).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled;
  });
});
