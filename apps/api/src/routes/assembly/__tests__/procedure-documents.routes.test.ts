import { prisma } from '../../../lib/prisma.js';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerAssemblyProcedureDocumentRoutes,
  type AssemblyProcedureDocumentRouteOptions
} from '../procedure-documents.js';

beforeEach(() => { vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null); });

const documentId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-21T00:00:00.000Z');

function buildDocument() {
  return {
    id: documentId,
    name: '手順書',
    imageRelativePath: '/uploads/procedure.png',
    status: 'DRAFT' as const,
    publishedAt: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    revisionMetadata: null,
    pages: [{ pageIndex: 0, imageRelativePath: '/uploads/procedure.png' }],
    overlayElements: []
  };
}

describe('assembly procedure document routes', () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    vi.restoreAllMocks();
  });

  it('keeps list, summary, detail, rename, and delete URLs registered', async () => {
    const document = buildDocument();
    const procedureService = {
      list: vi.fn().mockResolvedValue([document]),
      listSummary: vi.fn().mockResolvedValue([{ ...document, activeTemplateCount: 1, totalTemplateCount: 2 }]),
      getById: vi.fn().mockResolvedValue(document),
      rename: vi.fn().mockResolvedValue({ ...document, name: '変更後' }),
      getReferenceUsage: vi.fn().mockResolvedValue({ inBoltPageRef: false, inCheckPageRef: false }),
      deleteIfUnused: vi.fn().mockResolvedValue('deleted')
    };
    const options = {
      allowView: async () => undefined,
      allowWriteKiosk: async () => undefined,
      procedureService,
      procedureDraftImportService: { importDraft: vi.fn() },
      procedureGmailImportService: { ingest: vi.fn() }
    } as unknown as AssemblyProcedureDocumentRouteOptions;

    app = Fastify();
    registerAssemblyProcedureDocumentRoutes(app, options);
    await app.ready();

    const listResponse = await app.inject({ method: 'GET', url: '/assembly/procedure-documents?q=手順書' });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().documents[0]).toMatchObject({ id: documentId, name: '手順書' });

    const summaryResponse = await app.inject({ method: 'GET', url: '/assembly/procedure-documents/summary' });
    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json().documents[0]).toMatchObject({ activeTemplateCount: 1, totalTemplateCount: 2 });

    const detailResponse = await app.inject({ method: 'GET', url: `/assembly/procedure-documents/${documentId}` });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().document.id).toBe(documentId);

    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/assembly/procedure-documents/${documentId}`,
      payload: { name: '変更後' }
    });
    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json().document.name).toBe('変更後');

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/assembly/procedure-documents/${documentId}` });
    expect(deleteResponse.statusCode).toBe(204);
    expect(procedureService.list).toHaveBeenCalledWith({ includeInactive: false, q: '手順書', limit: undefined });
    expect(procedureService.rename).toHaveBeenCalledWith(documentId, '変更後', { holderKey: null, holderToken: null });
  });

  it('returns not found for an unknown document without changing the service contract', async () => {
    const procedureService = {
      list: vi.fn().mockResolvedValue([]),
      listSummary: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      rename: vi.fn(),
      getReferenceUsage: vi.fn(),
      deleteIfUnused: vi.fn()
    };
    app = Fastify();
    registerAssemblyProcedureDocumentRoutes(app, {
      allowView: async () => undefined,
      allowWriteKiosk: async () => undefined,
      procedureService,
      procedureDraftImportService: { importDraft: vi.fn() },
      procedureGmailImportService: { ingest: vi.fn() }
    } as unknown as AssemblyProcedureDocumentRouteOptions);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/assembly/procedure-documents/${documentId}`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: '手順書が見つかりません' });
  });
  it('returns display URLs for owned assets before an IMAGE overlay is saved', async () => {
    const asset = { id: 'pending-photo', storageKey: 'assembly-procedure-assets/photo.png', contentType: 'image/png', byteSize: 42 };
    app = Fastify();
    registerAssemblyProcedureDocumentRoutes(app, {
      allowView: async () => undefined,
      allowWriteKiosk: async () => undefined,
      procedureService: { getById: vi.fn().mockResolvedValue({ ...buildDocument(), ownedAssets: [asset] }) },
      procedureDraftImportService: {},
      procedureGmailImportService: {}
    } as unknown as AssemblyProcedureDocumentRouteOptions);
    const response = await app.inject({ method: 'GET', url: `/assembly/procedure-documents/${documentId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().document).toMatchObject({
      pages: [{ overlays: [] }],
      assets: { 'pending-photo': { assetId: asset.id, storageKey: asset.storageKey, contentType: asset.contentType, byteSize: 42, url: '/api/storage/assembly-procedure-assets/photo.png' } }
    });
  });
});
