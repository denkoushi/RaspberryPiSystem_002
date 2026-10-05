import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { AssemblyProcedureDocumentEditLeaseService, ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../../../services/assembly/assembly-procedure-document-edit-lease.service.js';
import { registerAssemblyProcedureDocumentEditLeaseRoutes } from '../procedure-document-edit-leases.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from '../procedure-document-revisions.js';
import { registerProcedureVideoRoutes } from '../procedure-videos.js';
import { registerAssemblyProcedureDocumentRoutes } from '../procedure-documents.js';

const id = '00000000-0000-4000-8000-000000000001';
const now = new Date();
const lease = { documentId: id, holderKey: 'client:other', holderToken: 'other-token', holderLabel: '端末B', acquiredAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + 300_000) };
const leaseDto = { holderLabel: '端末B', acquiredAt: now.toISOString(), heartbeatAt: now.toISOString(), expiresAt: lease.expiresAt.toISOString() };

describe('assembly procedure editing lease routes', () => {
  let app: ReturnType<typeof Fastify>;
  const allow = async () => undefined;
  const allowUser = async (request: FastifyRequest) => {
    request.user = { id: 'operator', username: '編集太郎', role: 'ADMIN' };
  };

  beforeEach(() => {
    app = Fastify(); registerErrorHandler(app);
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null);
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

  it('acquires and heartbeats with the user display name and forwards explicit takeover', async () => {
    const acquire = vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'acquire').mockResolvedValue({ lease: leaseDto, mine: true, holderToken: 'own-token' });
    registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk: allowUser });
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/edit-lease`, payload: {} });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ lease: leaseDto, mine: true, holderToken: 'own-token' });
    expect(acquire).toHaveBeenLastCalledWith(id, { holderKey: 'user:operator', holderLabel: '編集太郎' }, undefined, null);
    await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/edit-lease`, payload: { takeover: true } });
    expect(acquire).toHaveBeenLastCalledWith(id, expect.objectContaining({ holderKey: 'user:operator' }), true, null);
  });

  it('resolves the kiosk client name and releases only that actor', async () => {
    vi.spyOn(prisma.clientDevice, 'findUnique').mockResolvedValue({ id: 'kiosk', name: '組立端末' } as never);
    const acquire = vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'acquire').mockResolvedValue({ lease: leaseDto, mine: true, holderToken: 'own-token' });
    const release = vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'release').mockResolvedValue(undefined);
    registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk: allow });
    const headers = { 'x-client-key': 'client-key' };
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/edit-lease`, headers, payload: {} })).statusCode).toBe(200);
    expect(acquire).toHaveBeenCalledWith(id, { holderKey: 'client:kiosk', holderLabel: '組立端末' }, undefined, null);
    expect((await app.inject({ method: 'DELETE', url: `/assembly/procedure-documents/${id}/edit-lease`, headers })).statusCode).toBe(204);
    expect(release).toHaveBeenCalledWith(id, 'client:kiosk', null);
  });

  it('returns the holder details and required top-level code on acquisition conflict', async () => {
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'acquire').mockRejectedValue(new ApiError(409, '編集中', { lease: leaseDto }, ASSEMBLY_PROCEDURE_EDIT_LOCKED));
    registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk: allowUser });
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/edit-lease`, payload: {} });
    expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({ code: ASSEMBLY_PROCEDURE_EDIT_LOCKED, lease: leaseDto });
  });

  it('requires an authenticated actor', async () => {
    registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk: allow });
    expect((await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/edit-lease`, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/assembly/procedure-documents/${id}/edit-lease` })).statusCode).toBe(401);
  });

  it('checks kiosk write permission before either lease operation', async () => {
    const acquire = vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'acquire');
    const release = vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'release');
    registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk: async () => { throw new ApiError(403, '権限がありません'); } });
    for (const method of ['POST', 'DELETE'] as const) {
      expect((await app.inject({ method, url: `/assembly/procedure-documents/${id}/edit-lease` })).statusCode).toBe(403);
    }
    expect(acquire).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', 'overlays'], ['POST', 'pages/blank'], ['POST', `materials/${id}/place`],
    ['PUT', 'pages/0/videos'], ['PATCH', ''], ['DELETE', ''], ['POST', 'assets'], ['POST', 'regions/image'], ['POST', 'discard-revision'], ['POST', 'publish'], ['POST', 'approve-publish']
  ] as const)('blocks another holder before %s %s can mutate a document', async (method, suffix) => {
    vi.mocked(prisma.assemblyProcedureDocumentEditLease.findUnique).mockResolvedValue(lease);
    const mutate = vi.fn();
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: allow, allowWriteKiosk: allowUser }, { addBlankPage: mutate, saveOverlays: mutate, discardRevision: mutate } as never, {} as never);
    registerAssemblyProcedureDocumentRoutes(app, { allowView: allow, allowWriteKiosk: allowUser, procedureService: { publish: mutate, approvePublish: mutate } as never, procedureDraftImportService: {} as never, procedureGmailImportService: {} as never });
    registerProcedureVideoRoutes(app, { allowView: allow, allowWriteKiosk: allowUser, service: { replacePage: mutate } as never });
    const response = await app.inject({ method, url: `/assembly/procedure-documents/${id}${suffix ? `/${suffix}` : ''}`, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: ASSEMBLY_PROCEDURE_EDIT_LOCKED, lease: { holderLabel: '端末B' } });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('forwards holder identity and session token from mutation headers', async () => {
    const saveOverlays = vi.fn().mockResolvedValue({ id, name: '要領書', imageRelativePath: '/page.png', status: 'DRAFT', publishedAt: null, isActive: true, createdAt: now, updatedAt: now, pages: [], overlayElements: [], revisionMetadata: null });
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: allow, allowWriteKiosk: allowUser }, { saveOverlays } as never, {} as never);
    const response = await app.inject({ method: 'PUT', url: `/assembly/procedure-documents/${id}/overlays`, headers: { 'x-procedure-edit-token': 'session-token' }, payload: { accessPassword: '1234', expectedEditVersion: 0, elements: [] } });
    expect(response.statusCode).toBe(200);
    expect(saveOverlays).toHaveBeenCalledWith(expect.objectContaining({ holderKey: 'user:operator', holderToken: 'session-token' }));
  });

  it('preserves the existing overlay save for a client without a lease', async () => {
    const saveOverlays = vi.fn().mockResolvedValue({ id, name: '要領書', imageRelativePath: '/page.png', status: 'DRAFT', publishedAt: null, isActive: true, createdAt: now, updatedAt: now, pages: [], overlayElements: [], revisionMetadata: null });
    registerAssemblyProcedureDocumentRevisionRoutes(app, { allowView: allow, allowWriteKiosk: allow }, { saveOverlays } as never, {} as never);
    const response = await app.inject({ method: 'PUT', url: `/assembly/procedure-documents/${id}/overlays`, payload: { accessPassword: '1234', expectedEditVersion: 0, elements: [] } });
    expect(response.statusCode).toBe(200); expect(saveOverlays).toHaveBeenCalled();
  });
});
