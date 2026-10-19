import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureDictationRewriteService } from '../../../services/assembly/procedure-dictation-rewrite.service.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from '../procedure-document-revisions.js';

const url = '/assembly/procedure-documents/dictation/rewrite';
const payload = { mode: 'new', spokenText: ' 棚に直す ' };
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  app = Fastify(); registerErrorHandler(app);
  vi.spyOn(ProcedureDictationRewriteService.prototype, 'rewrite').mockResolvedValue({ text: '棚に戻す。' });
});
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });
function register(allowWriteKiosk = async () => {}) {
  registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk });
}

describe('dictation rewrite route', () => {
  it('returns text, trims spoken data and passes an abort signal', async () => {
    register();
    const result = await app.inject({ method: 'POST', url, payload });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(ProcedureDictationRewriteService.prototype.rewrite).toHaveBeenCalledExactlyOnceWith({ mode: 'new', spokenText: '棚に直す', signal: expect.any(AbortSignal) });
  });
  it.each([
    { ...payload, mode: 'bad' }, { ...payload, spokenText: ' ' }, { ...payload, spokenText: 'あ'.repeat(2001) },
    { ...payload, currentText: 'あ'.repeat(10001) }, { ...payload, mode: 'revise' }, { ...payload, mode: 'revise', currentText: ' ' }
  ])('rejects invalid data', async body => {
    register();
    expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(400);
    expect(ProcedureDictationRewriteService.prototype.rewrite).not.toHaveBeenCalled();
  });
  it('accepts a full revise request', async () => {
    register();
    expect((await app.inject({ method: 'POST', url, payload: { mode: 'revise', spokenText: '5番にして', currentText: '棚に戻す。' } })).statusCode).toBe(200);
  });
  it('requires kiosk write permission', async () => {
    register(async () => { throw new ApiError(403, '権限がありません'); });
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    expect(ProcedureDictationRewriteService.prototype.rewrite).not.toHaveBeenCalled();
  });
  it('returns the safe failure message', async () => {
    vi.mocked(ProcedureDictationRewriteService.prototype.rewrite).mockRejectedValue(new ApiError(502, '文にできません'));
    register();
    const result = await app.inject({ method: 'POST', url, payload });
    expect(result.statusCode).toBe(502); expect(result.json().message).toBe('文にできません');
  });
  it('aborts on client disconnect', async () => {
    let close = () => {};
    let signal: AbortSignal | undefined;
    app.addHook('onRequest', async (_request, reply) => { close = () => { reply.raw.emit('close'); }; });
    vi.mocked(ProcedureDictationRewriteService.prototype.rewrite).mockImplementation(async input => { signal = input.signal; close(); throw new ApiError(499, '文にできません'); });
    register();
    await expect(app.inject({ method: 'POST', url, payload })).rejects.toThrow('response destroyed before completion');
    expect(signal?.aborted).toBe(true);
  });
  it('limits requests to twenty per minute', async () => {
    await app.register(rateLimit, { global: false }); register();
    for (let i = 0; i < 20; i++) expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(429);
    expect(ProcedureDictationRewriteService.prototype.rewrite).toHaveBeenCalledTimes(20);
  });
});
