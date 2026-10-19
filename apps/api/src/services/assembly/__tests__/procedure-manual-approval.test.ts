import Fastify from 'fastify';
import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { registerAssemblyProcedureDocumentRoutes, serializeProcedureDocument, serializeProcedureDocumentSummary } from '../../../routes/assembly/procedure-documents.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';
import { serializeAssemblyProcedureDocumentRevision } from '../assembly-procedure-document-revision.serializer.js';

const id = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-10-05T09:00:00Z');
const employee = { id: 'employee', employeeCode: '001', displayName: '承認太郎', nfcTagUid: 'TAG', positionName: '班長', status: 'ACTIVE' };
function draft() {
  return { id, name: '要領書', imageRelativePath: '/page.png', status: 'DRAFT', isActive: true, publishedAt: null,
    createdAt: now, updatedAt: now, pages: [], overlayElements: [], ownedAssets: [], procedureManualApprovals: [],
    revisionMetadata: { revisionRootId: id, revisionNumber: 1, supersedesDocumentId: null, isRevisionHead: true, editVersion: 3 } };
}

describe('procedure-manual approval publication', () => {
  let app: ReturnType<typeof Fastify>;
  let document: ReturnType<typeof draft>;
  let approvals: unknown[];
  let password: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
    document = draft(); approvals = [];
    vi.spyOn(prisma.employee, 'findUnique').mockResolvedValue(employee as never);
    vi.spyOn(prisma.measuringInstrumentTag, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.knowledgePositionRank, 'findUnique').mockResolvedValue({ positionName: '班長', rank: 'leader' } as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id }]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockImplementation(async () => document as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'update').mockImplementation(async (args) => {
      document = { ...document, ...args.data } as typeof document;
      return document as never;
    });
    vi.spyOn(prisma.procedureManualApproval, 'create').mockImplementation(async (args) => {
      const row = { ...args.data, createdAt: now };
      approvals.push(row);
      document = { ...document, procedureManualApprovals: [row] as never };
      return row as never;
    });
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = document;
      const previous = [...approvals];
      try { return await work(prisma); } catch (error) { document = before; approvals = previous; throw error; }
    }) as never);
    password = vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => reply.status(error instanceof ApiError ? error.statusCode : 500).send({ message: error.message, code: (error as ApiError).code }));
    registerAssemblyProcedureDocumentRoutes(app, {
      allowView: async () => undefined,
      allowWriteKiosk: async request => { request.user = { id: 'operator' } as never; },
      procedureService: new AssemblyProcedureDocumentService({} as never),
      procedureDraftImportService: {} as never, procedureGmailImportService: {} as never
    });
    await app.ready();
  });
  afterEach(async () => { await app.close(); vi.restoreAllMocks(); });
  const publish = (expectedEditVersion = 3) => app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/approve-publish`, payload: { reviewerTagUid: 'TAG', expectedEditVersion, comment: '確認済み' } });

  it.each(['leader', 'section_chief', 'manager', 'general_manager', 'executive'])('publishes for %s, recording employee snapshots and the authenticated actor', async rank => {
    vi.mocked(prisma.knowledgePositionRank.findUnique).mockResolvedValue({ rank } as never);
    const response = await publish();
    expect(response.statusCode).toBe(200);
    expect(response.json().document).toMatchObject({ status: 'published', lastApproval: { employeeName: '承認太郎', positionName: '班長', approvedAt: now.toISOString() } });
    expect(approvals).toEqual([expect.objectContaining({ documentId: id, employeeId: 'employee', employeeCodeSnapshot: '001', employeeNameSnapshot: '承認太郎', employeeNfcTagUidSnapshot: 'TAG', employeePositionSnapshot: '班長', employeeRankSnapshot: rank, actorKey: 'user:operator', comment: '確認済み' })]);
    expect(password).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
  it.each(['general', null])('rejects general or unmapped positions with 403 before publication (%s)', async rank => {
    vi.mocked(prisma.knowledgePositionRank.findUnique).mockResolvedValue(rank ? { rank } as never : null);
    expect((await publish()).statusCode).toBe(403);
    expect(document.status).toBe('DRAFT'); expect(approvals).toEqual([]);
    expect(prisma.assemblyProcedureDocument.update).not.toHaveBeenCalled();
  });
  it('returns 404 for an unregistered tag', async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);
    expect((await publish()).statusCode).toBe(404);
    expect(approvals).toEqual([]); expect(document.status).toBe('DRAFT');
  });
  it('returns 403 for an inactive employee and 409 for a duplicate instrument tag', async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValueOnce({ ...employee, status: 'INACTIVE' } as never);
    expect((await publish()).statusCode).toBe(403);
    vi.mocked(prisma.measuringInstrumentTag.findUnique).mockResolvedValue({ id: 'instrument' } as never);
    expect((await publish()).statusCode).toBe(409);
    expect(document.status).toBe('DRAFT'); expect(approvals).toEqual([]);
  });
  it('returns 409 for stale editVersion with no publication or approval', async () => {
    const response = await publish(2);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('ASSEMBLY_PROCEDURE_EDIT_CONFLICT');
    expect(document.status).toBe('DRAFT'); expect(approvals).toEqual([]);
    expect(prisma.procedureManualApproval.create).not.toHaveBeenCalled();
  });
  it('returns 409 when another request publishes the draft while this one waits for the lock', async () => {
    const published = { ...draft(), status: 'PUBLISHED', publishedAt: now };
    vi.mocked(prisma.assemblyProcedureDocument.findUnique)
      .mockResolvedValueOnce(draft() as never)
      .mockResolvedValueOnce(published as never);
    const response = await publish();
    expect(response.statusCode).toBe(409);
    expect(approvals).toEqual([]);
    expect(prisma.assemblyProcedureDocument.update).not.toHaveBeenCalled();
  });
  it('rolls publication back when recording the approval fails', async () => {
    vi.mocked(prisma.procedureManualApproval.create).mockRejectedValueOnce(new Error('write failed'));
    expect((await publish()).statusCode).toBe(500);
    expect(document.status).toBe('DRAFT'); expect(approvals).toEqual([]);
  });
  it('retains the existing already-published behavior, without another approval', async () => {
    await publish();
    expect((await publish(0)).statusCode).toBe(200);
    expect(approvals).toHaveLength(1);
    expect(prisma.assemblyProcedureDocument.update).toHaveBeenCalledTimes(1);
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/publish`, payload: { accessPassword: 'secret', expectedEditVersion: 0 } });
    expect(response.statusCode).toBe(200); expect(password).toHaveBeenCalledWith('secret');
    expect(approvals).toHaveLength(1);
  });
  it('retains password publication without adding approvals', async () => {
    const response = await app.inject({ method: 'POST', url: `/assembly/procedure-documents/${id}/publish`, payload: { accessPassword: 'secret', expectedEditVersion: 3 } });
    expect(response.statusCode).toBe(200); expect(password).toHaveBeenCalledWith('secret');
    expect(document.status).toBe('PUBLISHED'); expect(approvals).toEqual([]);
  });
  it('confirms the approver without publishing', async () => {
    const response = await app.inject({ method: 'POST', url: '/assembly/procedure-documents/approval-reviewer', payload: { reviewerTagUid: 'TAG' } });
    expect(response.json()).toEqual({ reviewer: { displayName: '承認太郎', positionName: '班長', rank: 'leader' } });
    expect(document.status).toBe('DRAFT'); expect(approvals).toEqual([]);
  });
  it.each([{ isRevisionHead: false }, { isActive: false }])('rejects a non-head or inactive draft %j', async state => {
    document = { ...document, ...state, revisionMetadata: { ...document.revisionMetadata, ...state } };
    expect((await publish()).statusCode).toBe(409); expect(approvals).toEqual([]);
  });
  it('serializes approval snapshots and null through detail, revision, and summary', async () => {
    for (const serialize of [serializeProcedureDocument, serializeAssemblyProcedureDocumentRevision]) {
      document = draft();
      expect(serialize(document as never).lastApproval).toBeNull();
      await publish();
      expect(serialize(document as never).lastApproval).toEqual({ employeeName: '承認太郎', positionName: '班長', approvedAt: now.toISOString() });
    }
    expect(serializeProcedureDocumentSummary({ ...document, activeTemplateCount: 0, totalTemplateCount: 0 } as never).lastApproval?.employeeName).toBe('承認太郎');
    const include = vi.mocked(prisma.assemblyProcedureDocument.findUnique).mock.calls.at(-1)?.[0]?.include?.procedureManualApprovals;
    expect(include).toMatchObject({ take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  });
});
