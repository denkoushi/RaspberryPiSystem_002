import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { AssemblyProcedureDocumentEditLeaseService, ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../../../services/assembly/assembly-procedure-document-edit-lease.service.js';
import { ProcedureDictationRewriteService } from '../../../services/assembly/procedure-dictation-rewrite.service.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from '../procedure-document-revisions.js';

const url = '/assembly/procedure-documents/dictation/rewrite';
const payload = { mode: 'new', spokenText: ' 棚に直す ' };
const target = { documentId: '00000000-0000-4000-8000-000000000001', pageIndex: 0, elementId: 'text' };
const draft = { name: '要領書', status: 'DRAFT', isActive: true, revisionMetadata: { revisionRootId: 'root', isRevisionHead: true } };
let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  app = Fastify(); registerErrorHandler(app);
  vi.spyOn(ProcedureDictationRewriteService.prototype, 'rewrite').mockResolvedValue({ text: '棚に戻す。' });
  vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
  vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue(draft as never);
  vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([{ process: { name: '加工', parent: { name: '研削' } } }] as never);
  vi.spyOn(prisma.assemblyProcedureTextFeedback, 'create').mockResolvedValue({} as never);
  vi.spyOn(logger, 'debug').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
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
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).not.toHaveBeenCalled();
    expect(prisma.assemblyProcedureDocument.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { ...payload, mode: 'bad' }, { ...payload, spokenText: ' ' }, { ...payload, spokenText: 'あ'.repeat(2001) },
    { ...payload, currentText: 'あ'.repeat(10001) }, { ...payload, mode: 'revise' }, { ...payload, mode: 'revise', currentText: ' ' },
    { ...payload, originalText: 'あ'.repeat(10001) },
    { ...payload, ...target, documentId: 'bad' }, { ...payload, ...target, pageIndex: -1 }, { ...payload, ...target, pageIndex: 1.5 },
    { ...payload, ...target, elementId: '' }, { ...payload, ...target, elementId: 'a'.repeat(201) },
  ])('rejects invalid data', async body => {
    register();
    expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(400);
    expect(ProcedureDictationRewriteService.prototype.rewrite).not.toHaveBeenCalled();
  });
  it('accepts a full revise request', async () => {
    register();
    expect((await app.inject({ method: 'POST', url, payload: { mode: 'revise', spokenText: '5番にして', currentText: '棚に戻す。' } })).statusCode).toBe(200);
  });
  it.each([
    ['new', undefined, 'ここに文章を入力', 'ここに文章を入力', '棚に戻す。'],
    ['new', '既存。', undefined, '', '棚に戻す。'],
    ['append', '  既存。 ', '別の原文', '  既存。 ', '  既存。 \n棚に戻す。'],
    ['append', undefined, '別の原文', '', '\n棚に戻す。'],
    ['revise', '既存。', '別の原文', '既存。', '棚に戻す。'],
  ])('records a %s dictation with current text %j', async (mode, currentText, suppliedOriginal, originalText, aiText) => {
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target, mode, currentText, originalText: suppliedOriginal } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(ProcedureDictationRewriteService.prototype.rewrite).toHaveBeenCalledExactlyOnceWith({
      mode, documentId: target.documentId, spokenText: '棚に直す', ...(currentText === undefined ? {} : { currentText }), signal: expect.any(AbortSignal),
    });
    expect(prisma.procedureManualAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assemblyProcedureDocument: { revisionMetadata: { revisionRootId: 'root' } } },
    }));
    expect(prisma.assemblyProcedureTextFeedback.create).toHaveBeenCalledExactlyOnceWith({ data: {
      ...target, site: 'grinding', documentName: '要領書', source: 'DICTATION', mode, spokenText: '棚に直す', originalText, aiText,
    } });
  });
  it('skips recording with a partial target', async () => {
    register();
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, documentId: target.documentId, pageIndex: 0 } })).statusCode).toBe(200);
    expect(ProcedureDictationRewriteService.prototype.rewrite).toHaveBeenCalledWith(expect.objectContaining({ documentId: target.documentId }));
    expect(prisma.assemblyProcedureDocument.findUnique).not.toHaveBeenCalled();
  });
  it('returns the rewrite without recording an append the editor cannot apply', async () => {
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target, mode: 'append', currentText: 'あ'.repeat(10000) } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(prisma.assemblyProcedureDocument.findUnique).not.toHaveBeenCalled();
  });
  it.each([
    null, { ...draft, status: 'PUBLISHED' }, { ...draft, isActive: false },
    { ...draft, revisionMetadata: { ...draft.revisionMetadata, isRevisionHead: false } },
  ])('succeeds without recording for an unavailable draft %j', async document => {
    vi.mocked(prisma.assemblyProcedureDocument.findUnique).mockResolvedValue(document as never);
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(prisma.assemblyProcedureTextFeedback.create).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith({ documentId: target.documentId }, 'assembly_procedure_dictation_feedback_draft_unavailable');
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it('uses the edit actor and token and returns the rewrite when the document is locked', async () => {
    app.addHook('onRequest', async request => {
      request.user = { id: 'operator', username: 'operator' } as typeof request.user;
    });
    const assertCanWrite = vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite);
    assertCanWrite.mockRejectedValue(new ApiError(409, '編集中', undefined, ASSEMBLY_PROCEDURE_EDIT_LOCKED));
    register();
    const result = await app.inject({ method: 'POST', url, headers: { 'x-procedure-edit-token': 'session-token' }, payload: { ...payload, ...target } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(assertCanWrite).toHaveBeenCalledExactlyOnceWith(target.documentId, 'user:operator', undefined, 'session-token');
    expect(prisma.assemblyProcedureTextFeedback.create).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith({ documentId: target.documentId }, 'assembly_procedure_dictation_feedback_edit_locked');
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it('logs unexpected edit lease failures without changing the rewrite response', async () => {
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValue(new Error('lease lookup failed'));
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(prisma.assemblyProcedureTextFeedback.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ documentId: target.documentId, errorName: 'Error', errorMessage: 'lease lookup failed' }, 'assembly_procedure_dictation_feedback_proposal_failed');
  });
  it('returns the rewrite when feedback creation fails', async () => {
    const message = 'write failed: ' + 'x'.repeat(200);
    vi.mocked(prisma.assemblyProcedureTextFeedback.create).mockRejectedValue(new Error(message));
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ text: '棚に戻す。' });
    expect(logger.warn).toHaveBeenCalledWith({ documentId: target.documentId, errorName: 'Error', errorMessage: message.slice(0, 200) }, 'assembly_procedure_dictation_feedback_proposal_failed');
  });
  it('requires kiosk write permission', async () => {
    register(async () => { throw new ApiError(403, '権限がありません'); });
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    expect(ProcedureDictationRewriteService.prototype.rewrite).not.toHaveBeenCalled();
  });
  it('returns the safe failure message', async () => {
    vi.mocked(ProcedureDictationRewriteService.prototype.rewrite).mockRejectedValue(new ApiError(502, '文にできません'));
    register();
    const result = await app.inject({ method: 'POST', url, payload: { ...payload, ...target } });
    expect(result.statusCode).toBe(502); expect(result.json().message).toBe('文にできません');
    expect(prisma.assemblyProcedureDocument.findUnique).not.toHaveBeenCalled();
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
  it('skips recording when the client disconnects as the rewrite result becomes available', async () => {
    let close = () => {};
    let signal: AbortSignal | undefined;
    app.addHook('onRequest', async (_request, reply) => { close = () => { reply.raw.emit('close'); }; });
    vi.mocked(ProcedureDictationRewriteService.prototype.rewrite).mockImplementation(async input => {
      signal = input.signal;
      close();
      return { text: '棚に戻す。' };
    });
    register();
    await expect(app.inject({ method: 'POST', url, payload: { ...payload, ...target } })).rejects.toThrow('response destroyed before completion');
    // A disconnect rejects inject before the route necessarily finishes its work.
    await app.close();
    expect(signal?.aborted).toBe(true);
    expect(prisma.assemblyProcedureDocument.findUnique).not.toHaveBeenCalled();
    expect(prisma.assemblyProcedureTextFeedback.create).not.toHaveBeenCalled();
  });
  it('limits requests to twenty per minute', async () => {
    await app.register(rateLimit, { global: false }); register();
    for (let i = 0; i < 20; i++) expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(429);
    expect(ProcedureDictationRewriteService.prototype.rewrite).toHaveBeenCalledTimes(20);
  });
});
