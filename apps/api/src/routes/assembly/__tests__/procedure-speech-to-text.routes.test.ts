import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerRateLimit } from '../../../plugins/rate-limit.js';
import { PROCEDURE_SPEECH_HINTS } from '../../../services/assembly/procedure-speech-hints.js';
import * as adapter from '../../../services/inference/adapters/http-speech-to-text.adapter.js';
import { SpeechToTextUpstreamError } from '../../../services/inference/ports/speech-to-text.port.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from '../procedure-document-revisions.js';

const base = '/assembly/procedure-documents/dictation';
let app: ReturnType<typeof Fastify>;
const port = { isHealthy: vi.fn(), transcribe: vi.fn() };
function upload(size = 5, extra = '', field = 'file') {
  return Buffer.concat([
    Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="${field}"; filename="private-name.webm"\r\nContent-Type: audio/webm\r\n\r\n`),
    Buffer.alloc(size, 65), Buffer.from(`\r\n${extra}--test-boundary--\r\n`)
  ]);
}
function contextPart(value: string, name = 'context') {
  return `--test-boundary\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}
const headers = { 'content-type': 'multipart/form-data; boundary=test-boundary' };
function register(allowWriteKiosk = async () => {}) {
  registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk });
}
beforeEach(async () => {
  app = Fastify(); registerErrorHandler(app); await app.register(multipart);
  port.isHealthy.mockReset().mockResolvedValue(true); port.transcribe.mockReset().mockResolvedValue('  棚  ');
  vi.spyOn(adapter, 'createHttpSpeechToTextAdapter').mockReturnValue(port);
});
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

describe('procedure speech to text routes', () => {
  it.each(['before', 'after'])('accepts context %s the file', async order => {
    register();
    const context = contextPart('procedure-grinding');
    const payload = order === 'before' ? Buffer.concat([Buffer.from(context), upload()]) : upload(5, context);
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload });
    expect(result.statusCode).toBe(200);
    expect(port.transcribe).toHaveBeenCalledExactlyOnceWith(Buffer.from('AAAAA'), 'audio/webm', expect.any(AbortSignal), PROCEDURE_SPEECH_HINTS['procedure-grinding']);
  });
  it.each(['unknown', '', '__proto__'])('accepts unknown context %j without hints', async value => {
    register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload(5, contextPart(value)) });
    expect(result.statusCode).toBe(200);
    expect(port.transcribe).toHaveBeenCalledExactlyOnceWith(Buffer.from('AAAAA'), 'audio/webm', expect.any(AbortSignal), undefined);
  });
  it.each([
    upload(5, contextPart('procedure-assembly') + contextPart('procedure-grinding')),
    Buffer.concat([Buffer.from(contextPart('')), upload(5, contextPart('procedure-assembly'))]),
    upload(5, contextPart('a'.repeat(65))),
    Buffer.concat([Buffer.from(contextPart('ja', 'language')), upload()])
  ])('rejects duplicate, oversized or unrecognized fields', async payload => {
    register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload });
    expect(result.statusCode).toBe(400);
    expect(result.json().errorCode).toBe('ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_INVALID');
    expect(port.transcribe).not.toHaveBeenCalled();
  });
  it.each(['speech-to-text', 'transcribe'])('requires kiosk write permission for %s', async route => {
    register(async () => { throw new ApiError(403, '権限がありません'); });
    const result = await app.inject({ method: route === 'transcribe' ? 'POST' : 'GET', url: `${base}/${route}`, ...(route === 'transcribe' ? { headers, payload: upload() } : {}) });
    expect(result.statusCode).toBe(403); expect(port.isHealthy).not.toHaveBeenCalled(); expect(port.transcribe).not.toHaveBeenCalled();
  });
  it.each(['healthy', 'unhealthy', 'failed', 'off'])('returns safe availability when %s', async state => {
    if (state === 'unhealthy') port.isHealthy.mockResolvedValue(false);
    if (state === 'failed') port.isHealthy.mockRejectedValue(new Error('private detail'));
    if (state === 'off') vi.mocked(adapter.createHttpSpeechToTextAdapter).mockRestore();
    expect(env.PROCEDURE_SPEECH_TO_TEXT_ENABLED).toBe(false);
    register();
    const result = await app.inject({ method: 'GET', url: `${base}/speech-to-text` });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ available: state === 'healthy' });
  });
  it('returns trimmed text and forwards only in-memory audio, mime and signal', async () => {
    register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ text: '棚' });
    expect(port.transcribe).toHaveBeenCalledExactlyOnceWith(Buffer.from('AAAAA'), 'audio/webm', expect.any(AbortSignal), undefined);
  });
  it('returns 503 with flag off without calling upstream', async () => {
    vi.mocked(adapter.createHttpSpeechToTextAdapter).mockRestore(); register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(result.statusCode).toBe(503); expect(result.json().errorCode).toBe('ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_UNAVAILABLE');
    expect(port.transcribe).not.toHaveBeenCalled();
  });
  it.each([
    [400, 400, 'INVALID'], [413, 413, 'TOO_LARGE'], [429, 429, 'BUSY'], [401, 503, 'UNAVAILABLE'], [503, 503, 'UNAVAILABLE'], [500, 503, 'UNAVAILABLE']
  ])('maps upstream %s to %s', async (upstream, status, code) => {
    port.transcribe.mockRejectedValue(new SpeechToTextUpstreamError(upstream, '3')); register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(result.statusCode).toBe(status); expect(result.json().errorCode).toBe(`ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_${code}`);
    if (status === 429) expect(result.headers['retry-after']).toBe('3');
  });
  it.each([null, '0', 'invalid', '1000'])('defaults invalid Retry-After %s to 2', async value => {
    port.transcribe.mockRejectedValue(new SpeechToTextUpstreamError(429, value)); register();
    expect((await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() })).headers['retry-after']).toBe('2');
  });
  it.each(['network', 'timeout'])('maps %s failure safely', async kind => {
    port.transcribe.mockRejectedValue(new Error(`${kind}: private transcript`)); register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('private');
  });
  it.each([2_000_001, 2_100_000])('rejects %s bytes before forwarding', async size => {
    register(); const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload(size) });
    expect(result.statusCode).toBe(413); expect(result.json().errorCode).toBe('ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_TOO_LARGE');
    expect(port.transcribe).not.toHaveBeenCalled();
  });
  it('accepts exactly 2,000,000 bytes', async () => {
    register(); expect((await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload(2_000_000) })).statusCode).toBe(200);
  });
  it.each([
    Buffer.from('--test-boundary--\r\n'), upload(0), upload(5, '', 'other'),
    upload(5, '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="extra.webm"\r\nContent-Type: audio/webm\r\n\r\naudio\r\n'),
    upload(5, '--test-boundary\r\nContent-Disposition: form-data; name="language"\r\n\r\nja\r\n')
  ])('rejects missing or extra parts without forwarding', async payload => {
    register(); const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload });
    expect(result.statusCode).toBe(400); expect(result.json().errorCode).toBe('ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_INVALID');
    expect(port.transcribe).not.toHaveBeenCalled();
  });
  it('rejects non-multipart input', async () => {
    register(); const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, payload: {} });
    expect(result.statusCode).toBe(400); expect(port.transcribe).not.toHaveBeenCalled();
  });
  it('logs only safe metadata for upload failures', async () => {
    const logs: unknown[][] = [];
    app.addHook('onRequest', async request => {
      vi.spyOn(request.log, 'warn').mockImplementation((...args: unknown[]) => { logs.push(args); });
    });
    port.transcribe.mockRejectedValue(new Error('private transcript and upstream body')); register();
    const result = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(result.statusCode).toBe(503);
    expect(logs).toEqual([[{ status: 503, code: 'ASSEMBLY_PROCEDURE_SPEECH_TO_TEXT_UNAVAILABLE', aborted: false }, 'assembly_procedure_speech_to_text_failed']]);
    expect(result.body).not.toContain('private');
  });
  it('aborts upstream on client disconnect', async () => {
    let close = () => {}; let signal: AbortSignal | undefined;
    app.addHook('onRequest', async (_request, reply) => { close = () => { reply.raw.emit('close'); }; });
    port.transcribe.mockImplementation(async (_audio, _mime, inputSignal) => { signal = inputSignal; close(); throw new Error('aborted'); }); register();
    await expect(app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() })).rejects.toThrow('response destroyed before completion');
    expect(signal?.aborted).toBe(true);
  });
  it('limits transcription to twenty per minute', async () => {
    await app.register(registerRateLimit); register();
    for (let i = 0; i < 20; i++) expect((await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'POST', url: `${base}/transcribe`, headers, payload: upload() });
    expect(limited.statusCode).toBe(429); expect(limited.json().statusCode).toBeUndefined();
    expect(port.transcribe).toHaveBeenCalledTimes(20);
  });
});
