import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import {
  registerAssemblyProcedureDocumentRevisionRoutes
} from '../procedure-document-revisions.js';

const documentId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-21T00:00:00.000Z');

function makeRevision() {
  return {
    id: documentId,
    name: '改版手順書',
    imageRelativePath: '/api/storage/assembly-procedure-images/page-0.jpg',
    status: 'DRAFT' as const,
    publishedAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    pages: [
      {
        id: 'page-1',
        documentId,
        pageIndex: 0,
        imageRelativePath: '/api/storage/assembly-procedure-images/page-0.jpg',
        createdAt: now
      }
    ],
    overlayElements: [],
    revisionMetadata: {
      revisionRootId: documentId,
      revisionNumber: 2,
      supersedesDocumentId: '00000000-0000-4000-8000-000000000002',
      isRevisionHead: true,
      editVersion: 4,
      sourceAssetId: null,
      id: 'revision-meta-1',
      documentId,
      createdAt: now,
      updatedAt: now
    }
  };
}

function buildMultipartBody(params: {
  file: Buffer;
  filename: string;
  contentType: string;
  accessPassword: string;
}): { body: Buffer; contentType: string } {
  const boundary = '----assemblyProcedureRevisionRouteTest';
  const crlf = '\r\n';
  const chunks: Buffer[] = [];
  const append = (value: string) => chunks.push(Buffer.from(value, 'utf8'));

  append(`--${boundary}${crlf}`);
  append(`Content-Disposition: form-data; name="accessPassword"${crlf}${crlf}`);
  append(`${params.accessPassword}${crlf}`);
  append(`--${boundary}${crlf}`);
  append(
    `Content-Disposition: form-data; name="file"; filename="${params.filename}"${crlf}`
  );
  append(`Content-Type: ${params.contentType}${crlf}${crlf}`);
  chunks.push(params.file);
  append(`${crlf}--${boundary}--${crlf}`);

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function buildHarness() {
  const service = {
    listHistory: vi.fn(async () => [makeRevision()]),
    createRevision: vi.fn(async () => makeRevision()),
    saveOverlays: vi.fn(async () => makeRevision()),
    discardRevision: vi.fn(async () => makeRevision())
  };
  const assetsService = {
    uploadOverlayImage: vi.fn(async () => ({
      assetId: 'asset-uploaded',
      storageKey: 'assembly-procedure-assets/asset-uploaded.png',
      relativeUrl: '/api/storage/assembly-procedure-assets/asset-uploaded.png',
      sha256: 'a'.repeat(64),
      byteSize: 3,
      contentType: 'image/png',
      kind: 'OVERLAY_IMAGE' as const
    })),
    createImageRegion: vi.fn(async () => ({
      assetId: 'asset-region',
      storageKey: 'assembly-procedure-assets/asset-region.jpg',
      relativeUrl: '/api/storage/assembly-procedure-assets/asset-region.jpg',
      sha256: 'b'.repeat(64),
      byteSize: 4,
      contentType: 'image/jpeg',
      kind: 'OVERLAY_IMAGE' as const
    })),
    findTextCandidates: vi.fn(async () => [])
  };

  const app = Fastify();
  registerErrorHandler(app);
  return { app, service, assetsService };
}

describe('assembly procedure revision routes', () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('registers history/create/save/discard routes and forwards passwords and edit versions', async () => {
    const harness = buildHarness();
    app = harness.app;
    await app.register(multipart);
    registerAssemblyProcedureDocumentRevisionRoutes(
      app,
      {
        allowView: async () => undefined,
        allowWriteKiosk: async () => undefined
      },
      harness.service as never,
      harness.assetsService as never
    );
    await app.ready();

    const history = await app.inject({
      method: 'GET',
      url: `/assembly/procedure-documents/${documentId}/revisions`
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().revisions[0]).toMatchObject({
      id: documentId,
      revisionNumber: 2,
      editVersion: 4
    });

    const created = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/revisions`,
      headers: { 'content-type': 'application/json' },
      payload: { accessPassword: '2520' }
    });
    expect(created.statusCode).toBe(200);
    expect(harness.service.createRevision).toHaveBeenCalledWith(documentId, '2520');

    const saved = await app.inject({
      method: 'PUT',
      url: `/assembly/procedure-documents/${documentId}/overlays`,
      headers: { 'content-type': 'application/json' },
      payload: {
        accessPassword: '2520',
        expectedEditVersion: 4,
        elements: [
          {
            kind: 'TEXT',
            pageIndex: 0,
            bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
            text: '確認'
          }
        ]
      }
    });
    expect(saved.statusCode).toBe(200);
    expect(harness.service.saveOverlays).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId,
        accessPassword: '2520',
        expectedEditVersion: 4,
        elements: [expect.objectContaining({ kind: 'TEXT', text: '確認' })]
      })
    );

    const discarded = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/discard-revision`,
      headers: { 'content-type': 'application/json' },
      payload: { accessPassword: '2520', expectedEditVersion: 4 }
    });
    expect(discarded.statusCode).toBe(200);
    expect(harness.service.discardRevision).toHaveBeenCalledWith({
      documentId,
      accessPassword: '2520',
      expectedEditVersion: 4
    });
  });

  it('delegates multipart upload and both ROI operations, including an empty OCR result', async () => {
    const harness = buildHarness();
    app = harness.app;
    await app.register(multipart);
    registerAssemblyProcedureDocumentRevisionRoutes(
      app,
      {
        allowView: async () => undefined,
        allowWriteKiosk: async () => undefined
      },
      harness.service as never,
      harness.assetsService as never
    );
    await app.ready();

    const multipartPayload = buildMultipartBody({
      file: Buffer.from('png'),
      filename: '差替え.png',
      contentType: 'image/png',
      accessPassword: '2520'
    });
    const uploaded = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/assets`,
      headers: { 'content-type': multipartPayload.contentType },
      payload: multipartPayload.body
    });
    expect(uploaded.statusCode).toBe(200);
    expect(harness.assetsService.uploadOverlayImage).toHaveBeenCalledWith({
      documentId,
      accessPassword: '2520',
      bytes: Buffer.from('png'),
      contentType: 'image/png',
      originalFileName: '差替え.png'
    });

    const region = {
      accessPassword: '2520',
      pageIndex: 0,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 }
    };
    const imageRegion = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/regions/image`,
      headers: { 'content-type': 'application/json' },
      payload: region
    });
    expect(imageRegion.statusCode).toBe(200);
    expect(harness.assetsService.createImageRegion).toHaveBeenCalledWith({
      documentId,
      ...region
    });

    const textRegion = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/regions/text`,
      headers: { 'content-type': 'application/json' },
      payload: region
    });
    expect(textRegion.statusCode).toBe(200);
    expect(textRegion.json()).toEqual({ candidates: [] });
    expect(harness.assetsService.findTextCandidates).toHaveBeenCalledWith({
      documentId,
      ...region
    });
  });

  it('propagates an optimistic conflict as HTTP 409 without replacing the local payload', async () => {
    const harness = buildHarness();
    harness.service.saveOverlays.mockRejectedValueOnce(
      new ApiError(
        409,
        '手順書overlayが他の編集で更新されています',
        { currentEditVersion: 5 },
        'ASSEMBLY_PROCEDURE_EDIT_CONFLICT'
      )
    );
    app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(
      app,
      {
        allowView: async () => undefined,
        allowWriteKiosk: async () => undefined
      },
      harness.service as never,
      harness.assetsService as never
    );
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: `/assembly/procedure-documents/${documentId}/overlays`,
      headers: { 'content-type': 'application/json' },
      payload: {
        accessPassword: '2520',
        expectedEditVersion: 4,
        elements: []
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: '手順書overlayが他の編集で更新されています',
      errorCode: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT',
      details: { currentEditVersion: 5 }
    });
    expect(harness.service.saveOverlays).toHaveBeenCalledTimes(1);
  });
});
