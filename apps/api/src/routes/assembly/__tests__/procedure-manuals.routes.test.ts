import { prisma } from '../../../lib/prisma.js';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeMachineNameForCompare } from '../../../services/production-schedule/machine-name-compare.js';
import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureManualPartCandidatesService } from '../../../services/assembly/procedure-manual-part-candidates.service.js';
import { ProcedureManualService } from '../../../services/assembly/procedure-manual.service.js';
import { serializeProcedureSequence } from '../index.js';
import { registerAssemblyProcedureDocumentRoutes, type AssemblyProcedureDocumentRouteOptions } from '../procedure-documents.js';
import { registerProcedureManualRoutes } from '../procedure-manuals.js';

beforeEach(() => {
  vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null);
  vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ subjectKind: 'MODEL' } as never);
});

const documentId = '00000000-0000-4000-8000-000000000001';
const path = '/assembly/procedure-manuals/models/DFD1/processes/assembly';
describe('procedure-manual routes', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });

  function harness(writeDenied = false, viewDenied = false) {
    const service = {
      listProcesses: vi.fn().mockResolvedValue([{ id: 'assembly', subjectKind: 'MODEL' }]),
      normalizeSubjectKey: vi.fn(async (value: string) => normalizeMachineNameForCompare(value).trim()),
      getByPart: vi.fn(),
      listParts: vi.fn().mockResolvedValue([{ partNumber: 'PART-1', partNumberKey: 'PART-1' }]),
      listModels: vi.fn().mockResolvedValue([{ modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1' }]),
      getModelOverview: vi.fn(),
      getOverview: vi.fn(),
      getAssignments: vi.fn().mockResolvedValue({ assignments: [{ unavailableReason: 'no_published_revision' }], sequence: {
        mode: 'configured', source: 'primary_fallback', machineName: 'ｄｆｄ１', machineNameKey: 'DFD1',
        documents: [], steps: [], stepSource: 'document_expansion', fallbackProcedureDocument: null
      } }),
      replaceAssignments: vi.fn().mockResolvedValue(undefined)
    };
    const partCandidatesService = { list: vi.fn().mockResolvedValue([{ partNumber: 'NEW-1', partNumberKey: 'NEW-1', partName: '軸', hasManual: false }]) };
    const view = vi.fn(async () => { if (viewDenied) throw new ApiError(403, '権限がありません'); });
    app = Fastify();
    registerErrorHandler(app);
    registerProcedureManualRoutes(app, {
      allowView: view,
      allowWriteKiosk: async () => { if (writeDenied) throw new ApiError(403, '権限がありません'); },
      partCandidatesService: partCandidatesService as unknown as ProcedureManualPartCandidatesService,
      service: service as unknown as ProcedureManualService, serializeSequence: serializeProcedureSequence
    });
    return { service, view, partCandidatesService };
  }

  it('returns named production part candidates through allowView and forwards both searches', async () => {
    const { partCandidatesService, view } = harness();
    const response = await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/part-candidates?q=%E8%BB%B8&digitQuery=1&limit=30' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ parts: [{ partNumber: 'NEW-1', partNumberKey: 'NEW-1', partName: '軸', hasManual: false }] });
    expect(partCandidatesService.list).toHaveBeenCalledExactlyOnceWith({ q: '軸', digitQuery: '1', limit: 30 });
    expect(view).toHaveBeenCalledOnce();
  });

  it('accepts omitted/empty search parameters and the maximum limit', async () => {
    const { partCandidatesService } = harness();
    expect((await app.inject('/assembly/procedure-manuals/part-candidates')).statusCode).toBe(200);
    expect(partCandidatesService.list).toHaveBeenLastCalledWith({});
    expect((await app.inject('/assembly/procedure-manuals/part-candidates?q=&digitQuery=&limit=50')).statusCode).toBe(200);
    expect(partCandidatesService.list).toHaveBeenLastCalledWith({ q: '', digitQuery: '', limit: 50 });
  });

  it.each(['digitQuery=abc', 'digitQuery=%EF%BC%91', 'digitQuery=12.3', `digitQuery=${'1'.repeat(121)}`, `q=${'a'.repeat(121)}`, 'limit=0', 'limit=51', 'limit=1.5', 'limit=abc'])('rejects invalid part candidate query %s', async query => {
    const { partCandidatesService } = harness();
    expect((await app.inject(`/assembly/procedure-manuals/part-candidates?${query}`)).statusCode).toBe(400);
    expect(partCandidatesService.list).not.toHaveBeenCalled();
  });

  it('rejects part candidate viewing without permission', async () => {
    const { partCandidatesService } = harness(false, true);
    expect((await app.inject('/assembly/procedure-manuals/part-candidates?digitQuery=1')).statusCode).toBe(403);
    expect(partCandidatesService.list).not.toHaveBeenCalled();
  });

  it('serializes the by-part sequence and applies view permission and query validation', async () => {
    const { service, view } = harness();
    const detail = await service.getAssignments();
    service.getByPart.mockResolvedValue({ partNumber: 'PART-1', partNumberKey: 'PART-1', processes: [{ processId: 'cutting', processName: '切削', sequence: detail.sequence }] });
    const response = await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/by-part?partNumber=part-1' });
    expect(response.statusCode).toBe(200);
    expect(service.getByPart).toHaveBeenCalledWith('part-1');
    expect(response.json().processes[0].sequence).toMatchObject({ reason: null, stepSource: 'document_expansion' });
    expect(response.json()).not.toHaveProperty('modelCode');
    expect(view).toHaveBeenCalledOnce();
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/by-part?partNumber=%20' })).statusCode).toBe(400);
  });

  it('returns only part candidate keys through allowView', async () => {
    const { view } = harness();
    const response = await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/parts' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ parts: [{ partNumber: 'PART-1', partNumberKey: 'PART-1' }] });
    expect(view).toHaveBeenCalledOnce();
  });

  it('by-part rejects viewing without permission', async () => {
    const { service } = harness(false, true);
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/by-part?partNumber=P1' })).statusCode).toBe(403);
    expect(service.getByPart).not.toHaveBeenCalled();
  });

  it('validates PUT keys through the kind-aware service', async () => {
    const { service } = harness();
    service.normalizeSubjectKey.mockImplementation(async value => new ProcedureManualService().normalizeSubjectKey(value, 'cutting'));
    vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ subjectKind: 'PART' } as never);
    const url = '/assembly/procedure-manuals/models/PART-1/processes/cutting';
    expect((await app.inject({ method: 'PUT', url, payload: { modelCode: ' ｐａｒｔ－① ', assignments: [] } })).statusCode).toBe(200);
    expect(service.replaceAssignments).toHaveBeenCalledWith(' ｐａｒｔ－① ', 'cutting', []);
    expect((await app.inject({ method: 'PUT', url, payload: { modelCode: 'PART-2', assignments: [] } })).statusCode).toBe(400);
  });

  it('registers all three viewing routes and serializes the document expansion sequence', async () => {
    const { service, view } = harness();
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/processes' })).json()).toEqual({ processes: [{ id: 'assembly', subjectKind: 'MODEL' }] });
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/models' })).json().models[0].modelCodeKey).toBe('DFD1');
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json().sequence).toMatchObject({ stepSource: 'document_expansion', reason: null });
    expect(response.json().assignments[0].unavailableReason).toBe('no_published_revision');
    expect(service.getAssignments).toHaveBeenCalledWith('DFD1', 'assembly');
    expect(view).toHaveBeenCalledTimes(3);
  });

  it('returns the overview contract through allowView without changing existing responses', async () => {
    const { service, view } = harness();
    const overview = { modelCode: 'DFD1', modelCodeKey: 'DFD1', processes: [{ processId: 'assembly', count: 1, items: [{
      assignmentId: 'one', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId,
      title: '組立', status: 'published', publishedRevisionNumber: 2,
      draftRevision: { documentId: 'draft', revisionNumber: 3, editLease: { holderLabel: '佐藤', acquiredAt: '2026-10-06T00:00:00.000Z' } },
      unavailableReason: null, pageCount: 1, thumbnailPageUrl: '/api/storage/page.png'
    }] }] };
    service.getModelOverview.mockResolvedValue(overview);
    const response = await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/models/DFD1/overview' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(overview);
    expect(service.getModelOverview).toHaveBeenCalledWith('DFD1');
    expect(view).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'assembly'])('returns the cross-model overview through allowView (process=%s)', async processId => {
    const { service, view } = harness();
    const overview = { processes: [{ processId: 'assembly', count: 1, items: [{
      modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1', processId: 'assembly',
      assignmentId: 'one', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId,
      title: '組立', status: 'published', publishedRevisionNumber: 1, approval: null,
      draftRevision: null, unavailableReason: null, pageCount: 1, thumbnailPageUrl: null, otherAssignments: []
    }] }] };
    service.getOverview.mockResolvedValue(overview);
    const response = await app.inject({ method: 'GET', url: `/assembly/procedure-manuals/overview${processId ? `?processId=${processId}` : ''}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(overview);
    expect(service.getOverview).toHaveBeenCalledWith(processId, false);
    expect(view).toHaveBeenCalledOnce();
  });

  it('validates the optional overview process query before calling the service', async () => {
    const { service } = harness();
    for (const processId of ['', 'x'.repeat(201)]) {
      expect((await app.inject({ method: 'GET', url: `/assembly/procedure-manuals/overview?processId=${processId}` })).statusCode).toBe(400);
    }
    expect(service.getOverview).not.toHaveBeenCalled();
  });

  it.each(['', '1', 'yes', 'TRUE', 'true&published=false'])('rejects invalid published overview queries (%s)', async published => {
    const { service } = harness();
    expect((await app.inject({ method: 'GET', url: `/assembly/procedure-manuals/overview?published=${published}` })).statusCode).toBe(400);
    expect(service.getOverview).not.toHaveBeenCalled();
  });

  it.each([undefined, 'assembly'])('returns public counts without draft rows or draft revision data (process=%s)', async processId => {
    const { service } = harness();
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([{ id: 'assembly', parentId: 'parent' }] as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([
      { id: 'published', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', assemblyProcedureDocumentId: documentId },
      { id: 'initial-draft', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', assemblyProcedureDocumentId: 'draft-root' }
    ] as never);
    const document = { name: '公開文書', isActive: true, pages: [], procedureManualApprovals: [] };
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([
      { ...document, id: documentId, status: 'PUBLISHED' },
      { ...document, id: 'draft-root', name: '初版下書き', status: 'DRAFT' },
      { ...document, id: 'draft-v2', name: '改版下書き', status: 'DRAFT',
        revisionMetadata: { revisionRootId: documentId, revisionNumber: 2, supersedesDocumentId: documentId, isRevisionHead: true } }
    ] as never);
    const realService = new ProcedureManualService();
    service.getOverview.mockImplementation((id, published) => realService.getOverview(id, published));
    const response = await app.inject({ method: 'GET', url: `/assembly/procedure-manuals/overview?published=true${processId ? `&processId=${processId}` : ''}` });
    expect(response.statusCode).toBe(200);
    expect(service.getOverview).toHaveBeenCalledWith(processId, true);
    const process = response.json().processes[0];
    expect(process.count).toBe(1);
    expect(process.items).toHaveLength(1);
    expect(process.items[0]).toMatchObject({ assignmentId: 'published', status: 'published', draftRevision: null });
    expect(response.body).not.toContain('draft-root');
    expect(response.body).not.toContain('draft-v2');
    expect(response.body).not.toContain('下書き');
  });

  it('rejects cross-model viewing without allowView permission', async () => {
    const { service, view } = harness(false, true);
    expect((await app.inject({ method: 'GET', url: '/assembly/procedure-manuals/overview' })).statusCode).toBe(403);
    expect(view).toHaveBeenCalledOnce();
    expect(service.getOverview).not.toHaveBeenCalled();
  });

  it('saves the complete list and rejects a model key mismatch or invalid document choice', async () => {
    const { service } = harness();
    const assignments = [{ assemblyProcedureDocumentId: documentId, sortOrder: 0, label: '組立' }];
    expect((await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'ｄｆｄ１', assignments } })).statusCode).toBe(200);
    expect(service.replaceAssignments).toHaveBeenCalledWith('ｄｆｄ１', 'assembly', assignments);
    for (const payload of [
      { modelCode: 'OTHER', assignments }, { modelCode: '　', assignments },
      { modelCode: 'DFD1', assignments: [{ sortOrder: 0 }] },
      { modelCode: 'DFD1', assignments: [{ kioskDocumentId: documentId, assemblyProcedureDocumentId: documentId, sortOrder: 0 }] }
    ]) {
      expect((await app.inject({ method: 'PUT', url: path, payload })).statusCode).toBe(400);
    }
    expect(service.replaceAssignments).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for duplicate order values through the service and does not mutate assignments', async () => {
    harness();
    const realService = new ProcedureManualService();
    // Exercise the actual validation behind the route, without a database connection.
    app = await app.close().then(() => Fastify());
    registerErrorHandler(app);
    registerProcedureManualRoutes(app, { allowView: async () => undefined, allowWriteKiosk: async () => undefined, service: realService, serializeSequence: serializeProcedureSequence });
    const transaction = vi.spyOn(realService, 'replaceAssignments');
    const response = await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'DFD1', assignments: [
      { assemblyProcedureDocumentId: documentId, sortOrder: 0 }, { kioskDocumentId: documentId, sortOrder: 0 }
    ] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('並び順が重複');
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('rejects writes with 403 before calling the service', async () => {
    const { service } = harness(true);
    const response = await app.inject({ method: 'PUT', url: path, payload: { modelCode: 'DFD1', assignments: [] } });
    expect(response.statusCode).toBe(403);
    expect(service.replaceAssignments).not.toHaveBeenCalled();
  });

  it('reports procedure manual usage when an assigned document is deleted through the existing route', async () => {
    harness();
    const procedureService = {
      getReferenceUsage: vi.fn().mockResolvedValue({ inProcedureManualAssignment: true }),
      buildInUseMessage: vi.fn().mockReturnValue('要領書の機種×工程割り当てで使用中の手順書は削除・公開取消できません'),
      deleteIfUnused: vi.fn()
    };
    registerAssemblyProcedureDocumentRoutes(app, {
      allowView: async () => undefined, allowWriteKiosk: async () => undefined,
      procedureService, procedureDraftImportService: {}, procedureGmailImportService: {}
    } as unknown as AssemblyProcedureDocumentRouteOptions);
    const response = await app.inject({ method: 'DELETE', url: `/assembly/procedure-documents/${documentId}` });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('要領書の機種×工程割り当て');
    expect(procedureService.deleteIfUnused).not.toHaveBeenCalled();
  });
});
