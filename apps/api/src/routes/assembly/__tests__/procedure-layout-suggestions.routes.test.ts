import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../../lib/assembly-procedure-image-storage.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { LocalAssemblyProcedureAssetStorageAdapter } from '../../../services/assembly-procedure-assets/local-assembly-procedure-asset-storage.adapter.js';
import { AssemblyTemplateAccessService } from '../../../services/assembly/assembly-template-access.service.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../../../services/assembly/assembly-procedure-document-edit-lease.service.js';
import * as inferenceRuntime from '../../../services/inference/inference-runtime.js';
import { InferenceDeferredError, type TextCompletionPort } from '../../../services/inference/ports/text-completion.port.js';
import { ProcedureLayoutSuggestionService } from '../../../services/assembly/procedure-layout-suggestion.service.js';
import * as runtimeController from '../../../services/inference/runtime/get-local-llm-runtime-controller.js';
import type { VisionCompletionPort } from '../../../services/inference/ports/vision-completion.port.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from '../procedure-document-revisions.js';

const documentId = '00000000-0000-4000-8000-000000000001';
const url = `/assembly/procedure-documents/${documentId}/layout-suggestions`;
const elements = [
  { id: 'text', kind: 'TEXT' as const, pageIndex: 0, zIndex: 1, text: '1. 部品を取り付けます。', style: { fontSizeRatio: 0.025 }, bbox: { xRatio: 0.514, yRatio: 0.122, widthRatio: 0.4, heightRatio: 0.1 } },
  { id: 'photo', kind: 'IMAGE' as const, pageIndex: 0, zIndex: 0, assetId: 'asset-photo', objectFit: 'contain' as const, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 } },
  { id: 'shape', kind: 'SHAPE' as const, pageIndex: 0, zIndex: 2, shape: 'ELLIPSE' as const, bbox: { xRatio: 0.15, yRatio: 0.25, widthRatio: 0.1, heightRatio: 0.05 } },
];
const rewritten = { texts: [{ id: 'text', text: elements[0].text }] };

describe('procedure layout suggestion routes', () => {
  let app: ReturnType<typeof Fastify>;
  let text: TextCompletionPort;
  let vision: VisionCompletionPort;
  const controller = { ensureReady: vi.fn(), release: vi.fn() };

  beforeEach(async () => {
    app = Fastify();
    registerErrorHandler(app);
    text = { complete: vi.fn().mockResolvedValue({ rawText: JSON.stringify(rewritten), model: 'test' }) };
    vision = { complete: vi.fn().mockResolvedValue({ rawText: '不明' }) };
    vi.spyOn(inferenceRuntime, 'getInferenceRuntime').mockReturnValue({ createTextCompletionPort: () => text, createVisionCompletionPort: () => vision } as inferenceRuntime.InferenceRuntime);
    controller.ensureReady.mockReset().mockResolvedValue(undefined); controller.release.mockReset().mockResolvedValue(undefined);
    vi.spyOn(runtimeController, 'getLocalLlmRuntimeController').mockReturnValue(controller as never);
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
    vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ name: '架空の手順書', status: 'DRAFT', isActive: true, revisionMetadata: { revisionRootId: documentId, isRevisionHead: true } } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentPage, 'findUnique').mockResolvedValue({ imageRelativePath: '/page.png' } as never);
    vi.spyOn(prisma.assemblyProcedureCaptionFeedback, 'createMany').mockResolvedValue({ count: 2 });
    vi.spyOn(prisma.assemblyProcedureAsset, 'findMany').mockResolvedValue([{ id: 'asset-photo', storageKey: 'photo-key' }] as never);
    const buffer = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#ffffff' } }).png().toBuffer();
    vi.spyOn(AssemblyProcedureImageStorage, 'readImage').mockResolvedValue({ buffer } as never);
    vi.spyOn(LocalAssemblyProcedureAssetStorageAdapter.prototype, 'read').mockResolvedValue(buffer);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  function register(allowWriteKiosk = async () => {}) {
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk });
  }

  it('returns one unsaved complete layout and sends all exact TEXT IDs and text to inference', async () => {
    register();
    const payload = { pageIndex: 0, accessPassword: '1234', elements: elements.map(element => element.kind === 'TEXT' ? { ...element, text: '1.'.padEnd(260, '架') } : element) };
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result).not.toHaveProperty('plans');
    expect(result.elements.map((element: { id: string }) => element.id)).toEqual(elements.map(element => element.id));
    expect(result.addedElementIds).toEqual([]);
    expect(result.changes.length).toBeLessThanOrEqual(8);
    expect(result.elements.find((element: { id: string }) => element.id === 'photo').bbox).toMatchObject({ widthRatio: 0.3, heightRatio: 0.2 });
    expect(AssemblyTemplateAccessService.prototype.requireAccessPassword).toHaveBeenCalledWith('1234');
    expect(AssemblyProcedureImageStorage.readImage).toHaveBeenCalledWith('/page.png');
    const request = vi.mocked(text.complete).mock.calls[0][0];
    expect(request).toMatchObject({ useCase: 'business_hermes', jsonOutput: true, temperature: 0, enableThinking: false });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.messages[1].content)).toEqual({ texts: [{ id: 'text', text: payload.elements[0].kind === 'TEXT' ? payload.elements[0].text : '' }] });
    expect(controller.ensureReady).toHaveBeenCalledWith('business_hermes');
    expect(controller.release).toHaveBeenCalledWith('business_hermes');
  });

  it.each([new Error('upstream failed'), new InferenceDeferredError()])('returns 200 with original text and repaired layout after inference failure (%s)', async error => {
    vi.mocked(text.complete).mockRejectedValue(error);
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    expect(response.statusCode).toBe(200);
    expect(response.json().changes).toContain('文章はそのまま(AI が応答しませんでした)');
    expect(response.json().elements.find((element: { id: string }) => element.id === 'text').text).toBe(elements[0].text);
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it.each(['not json', '{}', '{"texts":4}'])('uses original text for invalid JSON (%s)', async rawText => {
    vi.mocked(text.complete).mockResolvedValue({ rawText, model: 'test' });
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    expect(response.statusCode).toBe(200);
    expect(response.json().changes).toContain('文章はそのまま(AI が応答しませんでした)');
  });

  it('continues when readiness fails and releases after completion failure', async () => {
    controller.ensureReady.mockRejectedValueOnce(new Error('not ready'));
    register();
    expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).statusCode).toBe(200);
    expect(text.complete).not.toHaveBeenCalled(); expect(controller.release).not.toHaveBeenCalled();
  });

  it('supports environments without a runtime controller', async () => {
    vi.mocked(runtimeController.getLocalLlmRuntimeController).mockReturnValue(null as never);
    register();
    expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).statusCode).toBe(200);
    expect(text.complete).toHaveBeenCalledOnce();
  });

  it('returns cancellation 499 from the service and releases the held runtime', async () => {
    const abort = new AbortController();
    vi.mocked(text.complete).mockImplementation(async () => { abort.abort(); throw new Error('aborted'); });
    await expect(new ProcedureLayoutSuggestionService().suggest({ documentId, pageIndex: 0, elements, signal: abort.signal })).rejects.toMatchObject({ statusCode: 499, code: 'ASSEMBLY_PROCEDURE_LAYOUT_CANCELLED' });
    expect(controller.release).toHaveBeenCalledOnce();
  });

  it('requires the same kiosk write permission as material placement', async () => {
    register(async () => { throw new ApiError(403, '権限がありません'); });
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    expect(response.statusCode).toBe(403);
    expect(text.complete).not.toHaveBeenCalled();
  });

  it('aborts inference when the response connection closes', async () => {
    let closeResponse: () => void = () => {};
    let inferenceSignal: AbortSignal | undefined;
    app.addHook('onRequest', async (_request, reply) => { closeResponse = () => { reply.raw.emit('close'); }; });
    vi.mocked(text.complete).mockImplementation(async (request) => {
      inferenceSignal = request.signal;
      closeResponse();
      throw new Error('aborted');
    });
    register();
    // A disconnected client cannot receive the service's cancellation response.
    await expect(app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).rejects.toThrow('response destroyed before completion');
    expect(inferenceSignal?.aborted).toBe(true);
    expect(text.complete).toHaveBeenCalledTimes(1);
  });

  it('honors edit lease rejection before calling inference', async () => {
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValue(new ApiError(409, '編集中です', { lease: null }, 'ASSEMBLY_PROCEDURE_EDIT_LOCKED'));
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    expect(response.statusCode).toBe(409);
    expect(text.complete).not.toHaveBeenCalled();
  });

  it('rejects published documents before calling inference', async () => {
    vi.mocked(prisma.assemblyProcedureDocument.findUnique).mockResolvedValue({ status: 'PUBLISHED', isActive: true, revisionMetadata: { revisionRootId: documentId, isRevisionHead: true } } as never);
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    expect(response.statusCode).toBe(409);
    expect(text.complete).not.toHaveBeenCalled();
  });

  const rowElements = (count = 3) => Array.from({ length: count }, (_, i) => [
    { ...elements[1], id: `p${i}`, bbox: { xRatio: 0.04, yRatio: 0.04 + i * 0.12, widthRatio: 0.3, heightRatio: 0.08 } },
    ...(i === 1 ? [] : [{ ...elements[0], id: `t${i}`, text: i === 0 ? '架空の工程' : '架空ワークを固定して確認する', bbox: { xRatio: 0.4, yRatio: 0.04 + i * 0.12, widthRatio: 0.5, heightRatio: 0.03 } }])
  ]).flat();

  it('calls vision serially only for heading-only and empty rows, converts PNG and records added text IDs', async () => {
    vi.mocked(text.complete).mockResolvedValue({ rawText: '{"texts":[]}', model: 'test' });
    let active = 0;
    vi.mocked(vision.complete).mockImplementation(async () => {
      expect(++active).toBe(1); await Promise.resolve(); active--;
      return { rawText: 'ワーク2個を固定する\n採用しない2行目' };
    });
    register();
    const input = rowElements();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: input } });
    expect(response.statusCode).toBe(200);
    expect(vision.complete).toHaveBeenCalledTimes(2);
    const request = vi.mocked(vision.complete).mock.calls[0][0];
    expect(request).toMatchObject({ mimeType: 'image/jpeg', maxTokens: 120, temperature: 0 });
    expect((await sharp(request.imageBytes).metadata()).format).toBe('jpeg');
    expect(request.userText).toContain('架空の手順書');
    expect(request.userText).toContain('1枚目: 架空の工程');
    expect(vi.mocked(vision.complete).mock.calls[1][0].userText).toContain('の2枚目の写真');
    const result = response.json();
    expect(prisma.assemblyProcedureCaptionFeedback.createMany).toHaveBeenCalledExactlyOnceWith({
      skipDuplicates: true,
      data: result.addedElementIds.map((elementId: string, index: number) => ({ documentId, pageIndex: 0, elementId,
        assetId: 'asset-photo', documentName: '架空の手順書', contextText: index === 0 ? '架空の工程' : null,
        aiText: 'ワーク2個を固定する', outcome: 'PROPOSED' }))
    });
    expect(result.addedElementIds).toHaveLength(2);
    expect(new Set(result.addedElementIds).size).toBe(2);
    expect(result.changes).toContain('写真を読んで 2 行足した');
    for (const id of result.addedElementIds) expect(result.elements.find((element: { id: string }) => element.id === id)).toMatchObject({ kind: 'TEXT', text: 'ワーク2個を固定する', style: { fontSizeRatio: 0.025 } });
    const heading = result.elements.find((element: { id: string }) => element.id === 't0');
    const added = result.elements.find((element: { id: string }) => element.id === result.addedElementIds[0]);
    expect(added.bbox.yRatio).toBeGreaterThan(heading.bbox.yRatio + heading.bbox.heightRatio);
  });

  it('returns the same successful proposal when feedback insertion fails', async () => {
    vi.mocked(text.complete).mockResolvedValue({ rawText: '{"texts":[]}', model: 'test' });
    vi.mocked(vision.complete).mockResolvedValue({ rawText: 'ワークを固定する' });
    vi.mocked(prisma.assemblyProcedureCaptionFeedback.createMany).mockRejectedValue(new Error('recording failed'));
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: rowElements() } });
    expect(response.statusCode).toBe(200);
    expect(response.json().addedElementIds).toHaveLength(2);
    expect(response.json().changes).toContain('写真を読んで 2 行足した');
    expect(prisma.assemblyProcedureCaptionFeedback.createMany).toHaveBeenCalledOnce();
  });

  it('does not record a built proposal if aborted before recording', async () => {
    const abort = new AbortController();
    vi.mocked(text.complete).mockResolvedValue({ rawText: '{"texts":[]}', model: 'test' });
    vi.mocked(vision.complete).mockResolvedValue({ rawText: 'ワークを固定する' });
    controller.release.mockImplementationOnce(async () => { abort.abort(); });
    await expect(new ProcedureLayoutSuggestionService().suggest({ documentId, pageIndex: 0, elements: rowElements(), signal: abort.signal })).rejects.toMatchObject({ statusCode: 499 });
    expect(prisma.assemblyProcedureCaptionFeedback.createMany).not.toHaveBeenCalled();
  });

  it.each(['不明', 'ワークは不明', '', '架'.repeat(31), '\n空の1行目'])('does not add rejected vision text (%s)', async rawText => {
    vi.mocked(vision.complete).mockResolvedValue({ rawText });
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: rowElements() } });
    expect(response.statusCode).toBe(200); expect(response.json().addedElementIds).toEqual([]);
  });

  it('skips failed vision or unreadable assets without rejecting the layout', async () => {
    vi.mocked(vision.complete).mockRejectedValueOnce(new Error('vision failed')).mockResolvedValueOnce({ rawText: 'ワークを固定する' });
    register();
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: rowElements() } });
    expect(response.statusCode).toBe(200); expect(response.json().addedElementIds).toHaveLength(1);
    vi.mocked(LocalAssemblyProcedureAssetStorageAdapter.prototype.read).mockRejectedValue(new Error('missing'));
    const next = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: rowElements() } });
    expect(next.statusCode).toBe(200); expect(next.json().addedElementIds).toEqual([]);
  });

  it('never reads photos or calls vision on non-column layouts or rows with full descriptions', async () => {
    register();
    const horizontal = [{ ...elements[1], id: 'left' }, { ...elements[1], id: 'right', bbox: { ...elements[1].bbox, xRatio: 0.6 } }, elements[0]];
    expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: horizontal } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).statusCode).toBe(200);
    expect(vision.complete).not.toHaveBeenCalled(); expect(LocalAssemblyProcedureAssetStorageAdapter.prototype.read).not.toHaveBeenCalled();
  });

  it('limits vision to six photos per request', async () => {
    register();
    const input = rowElements(7).filter(element => element.kind === 'IMAGE');
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: input } });
    expect(response.statusCode).toBe(200); expect(vision.complete).toHaveBeenCalledTimes(6);
  });

  it('cancels vision with 499 rather than silently skipping it', async () => {
    const abort = new AbortController();
    vi.mocked(vision.complete).mockImplementation(async () => { abort.abort(); return { rawText: 'ワークを固定する' }; });
    await expect(new ProcedureLayoutSuggestionService().suggest({ documentId, pageIndex: 0, elements: rowElements(), signal: abort.signal })).rejects.toMatchObject({ statusCode: 499 });
  });

  it('returns unchanged elements and the no-change message for an already finished page', async () => {
    register();
    const first = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } });
    const next = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: first.json().elements } });
    expect(next.statusCode).toBe(200); expect(next.json().elements).toEqual(first.json().elements);
    expect(next.json().changes).toEqual(['直すところはありません']);
  });

  it('returns the one-page fitting error when text alone overflows', async () => {
    vi.mocked(text.complete).mockResolvedValue({ rawText: '{"texts":[]}', model: 'test' });
    register();
    const overflowing = elements.map((element) => element.kind === 'TEXT' ? { ...element, text: '文'.repeat(10_000) } : element);
    const response = await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements: overflowing } });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe('ASSEMBLY_PROCEDURE_LAYOUT_DOES_NOT_FIT');
  });

  it('limits requests to four per minute', async () => {
    await app.register(rateLimit, { global: false });
    register();
    for (let count = 0; count < 4; count++) {
      expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url, payload: { pageIndex: 0, elements } })).statusCode).toBe(429);
    expect(text.complete).toHaveBeenCalledTimes(4);
  });
});
