import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { createHttpSpeechToTextAdapter, HttpSpeechToTextAdapter } from '../../inference/adapters/http-speech-to-text.adapter.js';
import * as inferenceRuntime from '../../inference/inference-runtime.js';
import { SpeechToTextUpstreamError, type SpeechToTextPort } from '../../inference/ports/speech-to-text.port.js';
import * as runtimeController from '../../inference/runtime/get-local-llm-runtime-controller.js';
import { ProcedureSpeechToTextService } from '../procedure-speech-to-text.service.js';

const audio = Buffer.from('private audio');
const signal = new AbortController().signal;
let port: SpeechToTextPort;
let service: ProcedureSpeechToTextService;
beforeEach(() => {
  port = { isHealthy: vi.fn().mockResolvedValue(true), transcribe: vi.fn().mockResolvedValue('  棚に戻す。  ') };
  service = new ProcedureSpeechToTextService(port);
});
afterEach(() => { env.PROCEDURE_SPEECH_TO_TEXT_ENABLED = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('procedure speech to text service', () => {
  it('trims text and never acquires a runtime lease', async () => {
    const runtime = vi.spyOn(runtimeController, 'getLocalLlmRuntimeController');
    expect(await service.transcribe(audio, 'audio/webm', signal)).toEqual({ text: '棚に戻す。' });
    expect(port.transcribe).toHaveBeenCalledExactlyOnceWith(audio, 'audio/webm', signal);
    expect(runtime).not.toHaveBeenCalled();
  });
  it('returns unavailable for no port or failed health', async () => {
    expect(await new ProcedureSpeechToTextService(null).isAvailable()).toBe(false);
    await expect(new ProcedureSpeechToTextService(null).transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ statusCode: 503 });
    expect(await service.isAvailable()).toBe(true);
    vi.mocked(port.isHealthy).mockRejectedValue(new Error('private upstream detail'));
    expect(await service.isAvailable()).toBe(false);
  });
  it.each([
    [400, 400, 'INVALID'], [413, 413, 'TOO_LARGE'], [429, 429, 'BUSY'],
    [401, 503, 'UNAVAILABLE'], [411, 503, 'UNAVAILABLE'], [500, 503, 'UNAVAILABLE'], [503, 503, 'UNAVAILABLE']
  ])('maps upstream %s to %s', async (upstream, statusCode, code) => {
    vi.mocked(port.transcribe).mockRejectedValue(new SpeechToTextUpstreamError(upstream));
    await expect(service.transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ statusCode, code: `ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_${code}` });
  });
  it.each([['3', 3], ['99', 99], [null, 2], ['0', 2], ['-1', 2], ['100', 2], ['bad', 2], ['1.5', 2]])('sanitizes Retry-After %s', async (header, expected) => {
    vi.mocked(port.transcribe).mockRejectedValue(new SpeechToTextUpstreamError(429, header as string | null));
    await expect(service.transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ details: { retryAfter: expected } });
  });
  it.each(['network', 'timeout'])('hides %s failures in response and logs', async kind => {
    const log = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.mocked(port.transcribe).mockRejectedValue(new Error(`${kind} private transcript`));
    await expect(service.transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ statusCode: 503, message: '音声認識が動いていません' });
    expect(log).toHaveBeenCalledExactlyOnceWith({ status: 503, code: 'ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_UNAVAILABLE', aborted: false }, 'assembly_procedure_speech_to_text_failed');
  });
  it('rejects oversized audio before calling upstream', async () => {
    await expect(service.transcribe(Buffer.alloc(2_000_001), 'audio/webm', signal)).rejects.toMatchObject({ statusCode: 413 });
    expect(port.transcribe).not.toHaveBeenCalled();
  });
  it('maps aborts before and during transcription to 499', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(service.transcribe(audio, 'audio/webm', abort.signal)).rejects.toMatchObject({ statusCode: 499 });
    expect(port.transcribe).not.toHaveBeenCalled();
    const active = new AbortController();
    vi.mocked(port.transcribe).mockImplementation(async () => { active.abort(); return 'private text'; });
    await expect(service.transcribe(audio, 'audio/webm', active.signal)).rejects.toMatchObject({ statusCode: 499 });
  });
});

describe('speech to text HTTP adapter', () => {
  it('defaults the flag off and resolves only the business provider when enabled', () => {
    expect(env.PROCEDURE_SPEECH_TO_TEXT_ENABLED).toBe(false);
    const resolve = vi.fn().mockReturnValue({ provider: { baseUrl: 'http://business:38081/path', sharedToken: 'business-token' } });
    vi.spyOn(inferenceRuntime, 'getInferenceRuntime').mockReturnValue({ router: { resolve } } as never);
    expect(createHttpSpeechToTextAdapter()).toBeNull(); expect(resolve).not.toHaveBeenCalled();
    env.PROCEDURE_SPEECH_TO_TEXT_ENABLED = true;
    expect(createHttpSpeechToTextAdapter()).toBeInstanceOf(HttpSpeechToTextAdapter);
    expect(resolve).toHaveBeenCalledExactlyOnceWith('business_hermes');
    resolve.mockImplementation(() => { throw new Error('No provider'); });
    expect(createHttpSpeechToTextAdapter()).toBeNull();
  });
  it('forwards exactly one file and the fixed model with token and known length', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '  棚  ' })));
    const adapter = new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081/path', sharedToken: 'business-token' }, fetchImpl);
    expect(await adapter.transcribe(audio, 'audio/webm', signal)).toBe('棚');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://business:38081/v1/audio/transcriptions');
    expect(init.method).toBe('POST'); expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(init.headers['X-LLM-Token']).toBe('business-token');
    expect(init.headers['Content-Length']).toBe(String(init.body.length));
    expect(init.body.length).toBeLessThan(2 * 1024 * 1024);
    const request = new Request(url, init);
    const form = await request.formData();
    expect([...form.keys()]).toEqual(['file', 'model']);
    expect(form.getAll('file')).toHaveLength(1);
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(Buffer.from(await (form.get('file') as File).arrayBuffer())).toEqual(audio);
  });
  it.each([true, false])('checks authenticated health (%s)', async healthy => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: healthy, enabled: healthy, model: 'whisper-large-v3-turbo', upstreamStatus: 200 }), { status: healthy ? 200 : 503 }));
    expect(await new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081', sharedToken: 'token' }, fetchImpl).isHealthy()).toBe(healthy);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://business:38081/system/speech-to-text/health');
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'X-LLM-Token': 'token' });
  });
  it('checks the enabled health field and hides network failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":true,"enabled":false}'));
    const adapter = new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081', sharedToken: 'token' }, fetchImpl);
    expect(await adapter.isHealthy()).toBe(false);
    fetchImpl.mockRejectedValue(new Error('network'));
    expect(await adapter.isHealthy()).toBe(false);
  });
  it.each([400, 401, 411, 413, 429, 503])('passes only status and Retry-After for HTTP %s', async status => {
    const response = new Response('private upstream transcript', { status, headers: { 'Retry-After': '3' } });
    const read = vi.spyOn(response, 'text');
    const adapter = new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081', sharedToken: 'token' }, vi.fn().mockResolvedValue(response));
    await expect(adapter.transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ status, retryAfter: '3' });
    expect(read).not.toHaveBeenCalled();
  });
  it('rejects invalid response and whole-request oversize', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"text":null}'));
    const adapter = new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081', sharedToken: 'token' }, fetchImpl);
    await expect(adapter.transcribe(audio, 'audio/webm', signal)).rejects.toMatchObject({ status: 503 });
    fetchImpl.mockClear();
    await expect(adapter.transcribe(Buffer.alloc(2 * 1024 * 1024), 'audio/webm', signal)).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['caller', 'timeout', 'health'])('aborts the HTTP request on %s', async reason => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      upstreamSignal = init.signal;
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const abort = new AbortController();
    const adapter = new HttpSpeechToTextAdapter({ baseUrl: 'http://business:38081', sharedToken: 'token' }, fetchImpl);
    const pending = reason === 'health' ? adapter.isHealthy() : adapter.transcribe(audio, 'audio/webm', abort.signal);
    const assertion = reason === 'health' ? expect(pending).resolves.toBe(false) : expect(pending).rejects.toThrow('aborted');
    if (reason === 'caller') abort.abort(); else await vi.advanceTimersByTimeAsync(reason === 'health' ? 3000 : 40000);
    await assertion; expect(upstreamSignal?.aborted).toBe(true);
  });
});
