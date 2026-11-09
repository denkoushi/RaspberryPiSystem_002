import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../observability/inference-observability.js', () => ({ emitInferenceCallOutcome: vi.fn() }));

import { emitInferenceCallOutcome } from '../../observability/inference-observability.js';
import { InferenceUnavailableError } from '../../ports/multi-image-vision-completion.port.js';
import { InferenceDeferredError } from '../../ports/text-completion.port.js';
import { InferenceRouter } from '../../routing/inference-router.js';
import { RoutedVisionCompletionAdapter } from '../routed-vision-completion.adapter.js';

const input = { userText: 'drawing', images: [{ label: 'source', imageBytes: Buffer.from('jpeg'), mimeType: 'image/jpeg' as const }], stream: true };
function setup(response: Response) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  const router = new InferenceRouter({ providers: [{ id: 'business', baseUrl: 'http://localhost:1234', sharedToken: 'test', defaultModel: 'system-prod-primary', timeoutMs: 1000 }], routes: {
    photo_label: { providerId: 'business' }, business_hermes: { providerId: 'business' }, security_review: { providerId: 'business' }, document_summary: { providerId: 'business' }, admin_console_chat: { providerId: 'business' },
  } });
  return { fetchImpl, adapter: new RoutedVisionCompletionAdapter({ router, fetchImpl, useCase: 'photo_label', getMaxTokens: () => 100, getTemperature: () => 0 }) };
}
function sse(parts: string[]) {
  const bytes = Buffer.from(parts.join(''));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    // Split every byte, including UTF-8 characters, field names and [DONE].
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe('multi-image vision streaming', () => {
  it('requests streaming and assembles split SSE lines until DONE', async () => {
    const h = setup(sse([': heartbeat\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\r\n',
      'data: {"choices":[{"delta":{"content":"図"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"面"}}]}\n',
      'data: [DONE]\n', 'data: {"choices":[{"delta":{"content":"ignored"}}]}\n']));
    expect(await h.adapter.completeMany(input)).toEqual({ rawText: '図面', modelRoute: 'photo_label:business', modelName: 'system-prod-primary' });
    expect(JSON.parse(h.fetchImpl.mock.calls[0][1]!.body as string).stream).toBe(true);
    expect(emitInferenceCallOutcome).toHaveBeenCalledOnce();
  });
  it.each([{ status: 502, background: false, error: InferenceUnavailableError },
    { status: 503, background: true, error: InferenceDeferredError }])('maps HTTP $status', async ({ status, background, error }) => {
    const h = setup(new Response('', { status }));
    await expect(h.adapter.completeMany({ ...input, background })).rejects.toBeInstanceOf(error);
    expect(emitInferenceCallOutcome).toHaveBeenCalledOnce();
  });
  it('maps stream read failures to unavailable', async () => {
    const h = setup(new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection lost')); } })));
    await expect(h.adapter.completeMany(input)).rejects.toBeInstanceOf(InferenceUnavailableError);
    expect(emitInferenceCallOutcome).toHaveBeenCalledOnce();
  });
  it.each(['caller', 'timeout'])('preserves the %s abort reason during reads', async (kind) => {
    vi.useFakeTimers();
    let failRead: (reason: unknown) => void = () => {};
    const h = setup(new Response(new ReadableStream({ start(controller) { failRead = (reason) => controller.error(reason); } })));
    h.fetchImpl.mockImplementation(async (_url, init) => {
      init!.signal!.addEventListener('abort', () => failRead(new TypeError('aborted read')));
      return new Response(new ReadableStream({ start(controller) { failRead = (reason) => controller.error(reason); } }));
    });
    const controller = new AbortController();
    const reason = new Error('cancelled by caller');
    const task = h.adapter.completeMany({ ...input, signal: controller.signal });
    const assertion = kind === 'caller' ? expect(task).rejects.toBe(reason) : expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    if (kind === 'caller') controller.abort(reason);
    else await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(emitInferenceCallOutcome).toHaveBeenCalledOnce();
  });
  it('rejects an empty stream as missing assistant text', async () => {
    const h = setup(sse(['data: [DONE]\n']));
    await expect(h.adapter.completeMany(input)).rejects.toThrow('Inference vision response missing assistant text');
  });
  it('consumes a final DONE line without a newline', async () => {
    const h = setup(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n', 'data: [DONE]']));
    expect((await h.adapter.completeMany(input)).rawText).toBe('ok');
  });
  it.each([['a cut line', 'data: {"choices":[{"delta":{"content":"x"'], ['a malformed line', 'data: {oops}\n']])('treats %s as unavailable', async (_name, tail) => {
    const h = setup(sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n', tail]));
    await expect(h.adapter.completeMany(input)).rejects.toBeInstanceOf(InferenceUnavailableError);
  });
  it('treats a stream that ends without DONE as unavailable', async () => {
    const h = setup(sse(['data: {"choices":[{"delta":{"content":"{\\"items\\":["}}]}\n']));
    await expect(h.adapter.completeMany(input)).rejects.toBeInstanceOf(InferenceUnavailableError);
  });
  it('keeps the non-stream request body unchanged', async () => {
    const h = setup(new Response('{"choices":[{"message":{"content":"ok"}}]}'));
    const { stream: _stream, ...nonStream } = input;
    expect((await h.adapter.completeMany(nonStream)).rawText).toBe('ok');
    expect(JSON.parse(h.fetchImpl.mock.calls[0][1]!.body as string)).toEqual({ model: 'system-prod-primary',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'drawing' }, { type: 'text', text: 'source' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,anBlZw==' } }] }],
      max_tokens: 100, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
  });
});
