import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentBlankService } from '../../../services/assembly/assembly-procedure-document-blank.service.js';
import { ProcedureMaterialPlacementService } from '../../../services/assembly/procedure-material-placement.service.js';

import { AssemblyProcedureDocumentEditLeaseService } from '../../../services/assembly/assembly-procedure-document-edit-lease.service.js';
import { AssemblyProcedureDocumentAssetsService } from '../../../services/assembly/assembly-procedure-document-assets.service.js';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import {
  registerAssemblyProcedureDocumentRevisionRoutes
} from '../procedure-document-revisions.js';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));

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
    templates: [{ areas: [{ bolts: [{ markerNo: 2 }] }] }],
    templateBolts: [{ pageIndex: null, markerNo: 3 }, { pageIndex: 0, markerNo: 1 }, { pageIndex: 0, markerNo: 3 }, { pageIndex: 1, markerNo: 9 }],
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

const rewriteSelection = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 };
const rewriteRequest = {
  method: 'POST' as const,
  url: `/assembly/procedure-documents/${documentId}/regions/text-rewrite`,
  payload: { accessPassword: '2520', pageIndex: 0, bbox: rewriteSelection }
};
const assertCanWrite = AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite;

function buildHarness() {
  const service = {
    addBlankPage: vi.fn(async () => makeRevision()),
    importPages: vi.fn(async () => makeRevision()),
    deletePage: vi.fn(async () => makeRevision()),
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
    findTextCandidates: vi.fn(async () => []),
    createTextRewriteRegion: vi.fn<AssemblyProcedureDocumentAssetsService['createTextRewriteRegion']>()
  };

  const app = Fastify();
  registerErrorHandler(app);
  return { app, service, assetsService };
}

describe('assembly procedure revision routes', () => {
  beforeEach(() => { vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined); });
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    vi.restoreAllMocks();
  });

  it('creates blank documents, appends pages and returns material draft elements', async () => {
    const harness = buildHarness(); app = harness.app;
    const blank = vi.spyOn(AssemblyProcedureDocumentBlankService.prototype, 'create').mockResolvedValue(makeRevision() as never);
    const element = { id: 'text', kind: 'TEXT' as const, text: '本文', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.8, heightRatio: 0.2 } };
    const place = vi.spyOn(ProcedureMaterialPlacementService.prototype, 'place').mockResolvedValue({ element });
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const created = await app.inject({ method: 'POST', url: '/assembly/procedure-documents/blank', payload: { name: '白紙' } });
    expect(created.statusCode).toBe(200); expect(created.json().document.status).toBe('draft');
    expect(blank).toHaveBeenCalledWith('白紙');
    const withAssignment = vi.spyOn(AssemblyProcedureDocumentBlankService.prototype, 'createWithAssignment').mockResolvedValue({ document: makeRevision(), assignmentError: '割り当てに失敗しました' } as never);
    const assigned = await app.inject({ method: 'POST', url: '/assembly/procedure-documents/blank', payload: { name: '白紙2', assignment: { modelCode: 'DFD1', processId: 'cutting' } } });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().assignmentError).toContain('割り当てに失敗');
    expect(withAssignment).toHaveBeenCalledWith('白紙2', { modelCode: 'DFD1', processId: 'cutting' });
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/blank`, payload: { expectedEditVersion: 4, accessPassword: '1234' } })).statusCode).toBe(200);
    expect(harness.service.addBlankPage).toHaveBeenCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null, documentId, expectedEditVersion: 4, accessPassword: '1234' });
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/blank`, payload: { expectedEditVersion: 4, afterPageIndex: 0 } })).statusCode).toBe(200);
    expect(harness.service.addBlankPage).toHaveBeenLastCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null, documentId, expectedEditVersion: 4, afterPageIndex: 0, accessPassword: '' });
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/blank`, payload: { expectedEditVersion: 4, afterPageIndex: -1 } })).statusCode).toBe(400);
    const placed = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/materials/${documentId}/place`, payload: { pageIndex: 0, accessPassword: '1234', employeeTagUid: ' tag ' } });
    expect(placed.json().element).toEqual(element);
    expect(place).toHaveBeenCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null, documentId, materialId: documentId, pageIndex: 0, accessPassword: '1234', employeeTagUid: 'tag' });
  });

  it.each(['/blank', `/${documentId}/pages/blank`, `/${documentId}/pages/import`, `/${documentId}/pages/0/delete`, `/${documentId}/materials/${documentId}/place`])('requires kiosk write permission for %s', async (suffix) => {
    const harness = buildHarness(); app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => { throw new ApiError(403, '権限がありません'); } }, harness.service as never, harness.assetsService as never);
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents${suffix}`, payload: { name: '白紙', pageIndex: 0, expectedEditVersion: 0 } })).statusCode).toBe(403);
    expect(harness.service.addBlankPage).not.toHaveBeenCalled();
    expect(harness.service.importPages).not.toHaveBeenCalled();
    expect(harness.service.deletePage).not.toHaveBeenCalled();
  });

  const importUrl = `/assembly/procedure-documents/${documentId}/pages/import`;
  const importPayload = {
    accessPassword: '1234', expectedEditVersion: 4,
    sourceDocumentId: '00000000-0000-4000-8000-000000000002', sourcePageIndexes: [2, 0], afterPageIndex: -1
  };

  it('passes ordered indexes and the edit reservation to the page import service', async () => {
    const harness = buildHarness(); app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: importUrl, headers: { 'x-procedure-edit-token': 'lease-token' }, payload: importPayload });
    expect(response.statusCode).toBe(200);
    expect(response.json().document).toMatchObject({ id: documentId, editVersion: 4, pages: [{ pageIndex: 0, overlays: [] }] });
    expect(harness.service.importPages).toHaveBeenCalledWith({ documentId, ...importPayload, clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: 'lease-token' });
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledWith(documentId, null, undefined, 'lease-token');
  });

  it.each([
    { sourcePageIndexes: [] }, { sourcePageIndexes: [0, 0] }, { sourcePageIndexes: [0.5] },
    { afterPageIndex: -2 }, { sourceDocumentId: 'invalid' }, { expectedEditVersion: undefined }
  ])('rejects invalid page import input %j', async extra => {
    const harness = buildHarness(); app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: importUrl, payload: { ...importPayload, ...extra } });
    expect(response.statusCode).toBe(400);
    expect(harness.service.importPages).not.toHaveBeenCalled();
  });

  it('returns a page import version conflict with the current edit version', async () => {
    const harness = buildHarness(); app = harness.app;
    harness.service.importPages.mockRejectedValue(new ApiError(409, '最新内容を再読込してください', { currentEditVersion: 5 }, 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT'));
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: importUrl, payload: importPayload });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT', details: { currentEditVersion: 5 } });
  });

  it('deletes a page with the password, required version and reservation token', async () => {
    const harness = buildHarness(); app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/1/delete`, headers: { 'x-procedure-edit-token': 'lease-token' }, payload: { accessPassword: '1234', expectedEditVersion: 4 } });
    expect(response.statusCode).toBe(200);
    expect(response.json().document).toMatchObject({ id: documentId, editVersion: 4, pages: [{ pageIndex: 0 }] });
    expect(harness.service.deletePage).toHaveBeenCalledWith({ documentId, pageIndex: 1, accessPassword: '1234', expectedEditVersion: 4, clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: 'lease-token' });
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledWith(documentId, null, undefined, 'lease-token');
  });

  it.each([{ pageIndex: '0', body: {} }, { pageIndex: '-1', body: { expectedEditVersion: 4 } }, { pageIndex: '1.5', body: { expectedEditVersion: 4 } }])('validates deletion input %j before calling the service', async ({ pageIndex, body }) => {
    const harness = buildHarness(); app = harness.app;
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/${pageIndex}/delete`, payload: body });
    expect(response.statusCode).toBe(400);
    expect(harness.service.deletePage).not.toHaveBeenCalled();
  });

  it.each([
    new ApiError(403, 'パスワードが違います'),
    new ApiError(409, '最後の1ページは削除できません'),
    new ApiError(400, '削除するページが存在しません'),
    new ApiError(409, 'このページまたは後ろのページがテンプレートで使われているため、削除できません'),
    new ApiError(409, '最新内容を再読込してください', { currentEditVersion: 5 }, 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT')
  ])('returns deletion refusal: $message', async error => {
    const harness = buildHarness(); app = harness.app;
    harness.service.deletePage.mockRejectedValue(error);
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/0/delete`, payload: { expectedEditVersion: 4 } });
    expect(response.statusCode).toBe(error.statusCode);
    expect(response.json().message).toBe(error.message);
    if (error.code) expect(response.json()).toMatchObject({ errorCode: error.code, details: { currentEditVersion: 5 } });
  });

  it('refuses deletion when the reservation is lost before calling the service', async () => {
    const harness = buildHarness(); app = harness.app;
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValueOnce(new ApiError(409, '別の端末が編集中です', { lease: null }, 'ASSEMBLY_PROCEDURE_EDIT_LOCKED'));
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/pages/0/delete`, payload: { expectedEditVersion: 4 } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('ASSEMBLY_PROCEDURE_EDIT_LOCKED');
    expect(harness.service.deletePage).not.toHaveBeenCalled();
  });

  it('returns 409 and the placement error for discarded materials', async () => {
    const harness = buildHarness(); app = harness.app;
    vi.spyOn(ProcedureMaterialPlacementService.prototype, 'place').mockRejectedValue(new ApiError(409, '捨てた素材は配置できません'));
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${documentId}/materials/${documentId}/place`, payload: { pageIndex: 0 } });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('捨てた素材は配置できません');
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
    expect(harness.service.createRevision).toHaveBeenCalledWith(documentId, '2520', { clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null });

    const saved = await app.inject({
      method: 'PUT',
      url: `/assembly/procedure-documents/${documentId}/overlays`,
      headers: { 'content-type': 'application/json' },
      payload: {
        accessPassword: '2520',
        expectedEditVersion: 4,
        appliedCaptionElementIds: ['caption-id'],
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
        elements: [expect.objectContaining({ kind: 'TEXT', text: '確認' })],
        appliedCaptionElementIds: ['caption-id']
      })
    );

    const discarded = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/discard-revision`,
      headers: { 'content-type': 'application/json' },
      payload: { accessPassword: '2520', expectedEditVersion: 4 }
    });
    expect(discarded.statusCode).toBe(200);
    expect(harness.service.discardRevision).toHaveBeenCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null,
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
    expect(harness.assetsService.uploadOverlayImage).toHaveBeenCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null,
      documentId,
      accessPassword: '2520',
      bytes: Buffer.from('png'),
      contentType: 'image/png',
      originalFileName: '差替え.png'
    });

    const region = {
      accessPassword: '2520',
      pageIndex: 0,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 },
      overlays: [{ assetId: 'material', bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }, zIndex: 1, objectFit: 'fill', opacity: 0.5 }]
    };
    const imageRegion = await app.inject({
      method: 'POST',
      url: `/assembly/procedure-documents/${documentId}/regions/image`,
      headers: { 'content-type': 'application/json' },
      payload: region
    });
    expect(imageRegion.statusCode).toBe(200);
    expect(harness.assetsService.createImageRegion).toHaveBeenCalledWith({ clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null,
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
      clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: null,
      documentId,
      ...region
    });
  });

  it('returns the text rewrite patch and forwards the edit token', async () => {
    const harness = buildHarness(); app = harness.app;
    const dto = {
      asset: await harness.assetsService.createImageRegion(),
      patchBBox: rewriteSelection,
      text: '締付確認',
      textBBox: { xRatio: 0.12, yRatio: 0.22, widthRatio: 0.19, heightRatio: 0.03 },
      color: '#141414',
      fontSizeRatio: 0.03
    };
    harness.assetsService.createTextRewriteRegion.mockResolvedValue(dto);
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject({ ...rewriteRequest, headers: { 'x-procedure-edit-token': 'lease-token' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dto);
    expect(harness.assetsService.createTextRewriteRegion).toHaveBeenCalledWith({
      ...rewriteRequest.payload, documentId, clientDeviceId: null, ip: '127.0.0.1', holderKey: null, holderToken: 'lease-token'
    });
  });

  it('returns 422 when text rewriting finds no bounded candidates', async () => {
    const harness = buildHarness(); app = harness.app;
    harness.assetsService.createTextRewriteRegion.mockRejectedValue(new ApiError(422, '文字が見つかりませんでした'));
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    const response = await app.inject(rewriteRequest);
    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('文字が見つかりませんでした');
  });

  it('rejects text rewriting and image cropping when another device holds an active edit lease', async () => {
    const harness = buildHarness(); app = harness.app;
    const acquiredAt = new Date();
    const expiresAt = new Date(acquiredAt.getTime() + 60_000);
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockImplementation(assertCanWrite);
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue({
      documentId, holderKey: 'other-device', holderToken: 'other-token', holderLabel: '別の端末',
      acquiredAt, heartbeatAt: acquiredAt, expiresAt
    });
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: async () => {}, allowWriteKiosk: async () => {} }, harness.service as never, harness.assetsService as never);
    for (const url of [rewriteRequest.url, `/assembly/procedure-documents/${documentId}/regions/image`]) {
      const response = await app.inject({ ...rewriteRequest, url });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED',
        message: '別の端末が編集中です',
        lease: {
          holderLabel: '別の端末',
          acquiredAt: acquiredAt.toISOString(),
          heartbeatAt: acquiredAt.toISOString(),
          expiresAt: expiresAt.toISOString()
        }
      });
    }
    expect(harness.assetsService.createTextRewriteRegion).not.toHaveBeenCalled();
    expect(harness.assetsService.createImageRegion).not.toHaveBeenCalled();
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
