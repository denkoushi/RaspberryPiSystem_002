import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { ProcedureManualService } from '../procedure-manual.service.js';

const now = new Date('2026-10-05T00:00:00Z');
const rootId = '00000000-0000-4000-8000-000000000001';
const pdfId = '00000000-0000-4000-8000-000000000002';
function document(id = rootId) {
  return {
    id, name: '公開手順', status: 'PUBLISHED', isActive: true, updatedAt: now,
    imageRelativePath: '/api/storage/assembly-procedure-images/test.jpg',
    pages: [{ pageIndex: 0, imageRelativePath: '/api/storage/assembly-procedure-images/test.jpg' }],
    overlayElements: [], revisionMetadata: null
  };
}
function assignment(id: string, assemblyProcedureDocumentId: string | null = rootId, sortOrder = 0) {
  return {
    id, modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1', processId: 'assembly', sortOrder,
    label: null, assemblyProcedureDocumentId, kioskDocumentId: null, kioskDocument: null
  };
}

describe('procedure-manual service', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists assembly children before machining children', async () => {
    const machining = { id: 'cutting', parentId: 'procedure-manual-machining', sortOrder: 0 };
    const assembly = { id: 'assembly', parentId: 'procedure-manual-assembly', sortOrder: 0 };
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([machining, assembly] as never);
    expect((await new ProcedureManualService().listProcesses()).map(process => process.id)).toEqual(['assembly', 'cutting']);
  });

  it('resolves an older published revision even when the revision head is a draft', async () => {
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([assignment('one')] as never);
    const published = { ...document('published-v2'), procedureManualApprovals: [{ employeeNameSnapshot: '承認太郎', employeePositionSnapshot: '班長', createdAt: now }] };
    const revisions = [
      { revisionNumber: 3, document: { ...document('draft-v3'), status: 'DRAFT' } },
      { revisionNumber: 2, document: published }
    ];
    const revisionQuery = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockImplementation(async (args) => {
      const wanted = args?.where?.document as { status?: string; isActive?: boolean };
      return revisions.find((r) => r.document.status === wanted.status && r.document.isActive === wanted.isActive) as never;
    });
    const result = await new ProcedureManualService().getAssignments('ｄｆｄ１', 'assembly');
    expect(revisionQuery).toHaveBeenCalledWith(expect.objectContaining({
      where: { revisionRootId: rootId, document: { status: 'PUBLISHED', isActive: true } },
      orderBy: { revisionNumber: 'desc' }
    }));
    expect(result.assignments[0]).toMatchObject({ assemblyProcedureDocumentId: rootId, resolvedDocumentId: 'published-v2', unavailableReason: null });
    expect(result.sequence.documents[0].assemblyProcedureDocumentId).toBe('published-v2');
    expect(result.sequence.documents[0].lastApproval).toEqual({ employeeName: '承認太郎', positionName: '班長', approvedAt: now.toISOString() });
    expect(result.sequence.stepSource).toBe('document_expansion');
    expect(result.sequence.steps[0]).toMatchObject({ pageIndex: 0, viewMode: 'FULL_PAGE' });
  });

  it('keeps other items visible when one root has no published revision, and supports legacy documents', async () => {
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([
      assignment('missing', 'draft-root'), assignment('legacy', rootId, 1)
    ] as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findFirst').mockImplementation(async (args) =>
      args?.where?.id === rootId ? document() as never : null
    );
    const result = await new ProcedureManualService().getAssignments('DFD1', 'assembly');
    expect(result.assignments[0].unavailableReason).toBe('no_published_revision');
    expect(result.sequence.documents.map((d) => d.orderItemId)).toEqual(['legacy']);
  });

  it('renders PDF assignments in the same ordered sequence', async () => {
    const row = { ...assignment('pdf', null), kioskDocumentId: pdfId, kioskDocument: {
      id: pdfId, enabled: true, title: 'PDF', displayTitle: null, filename: 'test.pdf',
      confirmedDocumentNumber: null, confirmedSummaryText: null, pageCount: 2, updatedAt: now, filePath: '/test.pdf'
    } };
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([row] as never);
    const render = { convertPdfToPageUrls: vi.fn().mockResolvedValue(['/page1.png', '/page2.png']) };
    const result = await new ProcedureManualService(render as never).getAssignments('DFD1', 'assembly');
    expect(result.sequence.steps).toHaveLength(2);
    expect(result.sequence.documents[0].kioskDocumentId).toBe(pdfId);
  });

  it('rejects empty normalized models, duplicate order values and invalid document choices before writing', async () => {
    const transaction = vi.spyOn(prisma, '$transaction');
    const service = new ProcedureManualService();
    await expect(service.replaceAssignments('　', 'assembly', [])).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.replaceAssignments('DFD1', 'assembly', [
      { assemblyProcedureDocumentId: rootId, sortOrder: 0 }, { kioskDocumentId: pdfId, sortOrder: 0 }
    ])).rejects.toThrow('並び順が重複');
    await expect(service.replaceAssignments('DFD1', 'assembly', [{ sortOrder: 0 }])).rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('saves reordering and labels with a published root and an automatically assigned unpublished DRAFT', async () => {
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'assembly' }]);
    vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ id: 'assembly' } as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([assignment('published'), assignment('auto-draft', 'draft-root', 1)] as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockImplementation(async (args) => ({ ...document(args.where.id), revisionMetadata: { revisionRootId: args.where.id } }) as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockImplementation(async (args) => args?.where?.revisionRootId === rootId ? { document: document() } as never : null);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findFirst').mockResolvedValue(null);
    const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany').mockResolvedValue({ count: 2 });
    const create = vi.spyOn(prisma.procedureManualAssignment, 'createMany').mockResolvedValue({ count: 2 });
    const service = new ProcedureManualService();
    await service.replaceAssignments('DFD1', 'assembly', [
      { assemblyProcedureDocumentId: 'draft-root', sortOrder: 0, label: '新しい下書きの表示名' },
      { assemblyProcedureDocumentId: rootId, sortOrder: 1, label: '公開手順の表示名' }
    ]);
    expect(create).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ assemblyProcedureDocumentId: 'draft-root', sortOrder: 0, label: '新しい下書きの表示名' }),
      expect.objectContaining({ assemblyProcedureDocumentId: rootId, sortOrder: 1, label: '公開手順の表示名' })
    ] });
    remove.mockClear(); create.mockClear();
    await expect(service.replaceAssignments('DFD1', 'assembly', [{ assemblyProcedureDocumentId: 'unassigned-draft', sortOrder: 0 }])).rejects.toThrow('公開版がありません');
    expect(remove).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it('replaces one normalized model/process atomically, canonicalizing a selected revision to its root', async () => {
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([]);
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'assembly' }]);
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
    vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ id: 'assembly' } as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ ...document('v2'), revisionMetadata: { revisionRootId: rootId } } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockResolvedValue({ document: document('v2') } as never);
    vi.spyOn(prisma.kioskDocument, 'findFirst').mockResolvedValue({ id: pdfId } as never);
    const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany').mockResolvedValue({ count: 2 });
    const create = vi.spyOn(prisma.procedureManualAssignment, 'createMany').mockResolvedValue({ count: 2 });
    await new ProcedureManualService().replaceAssignments('ｄｆｄ１', 'assembly', [
      { assemblyProcedureDocumentId: 'v2', sortOrder: 0, label: '組立' }, { kioskDocumentId: pdfId, sortOrder: 1 }
    ]);
    expect(query.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(remove).toHaveBeenCalledWith({ where: { modelCodeKey: 'DFD1', processId: 'assembly' } });
    expect(create).toHaveBeenCalledWith({ data: [
      { modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1', processId: 'assembly', assemblyProcedureDocumentId: rootId, kioskDocumentId: null, sortOrder: 0, label: '組立' },
      { modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1', processId: 'assembly', assemblyProcedureDocumentId: null, kioskDocumentId: pdfId, sortOrder: 1, label: null }
    ] });
    create.mockRejectedValueOnce(new Error('unique constraint'));
    await expect(new ProcedureManualService().replaceAssignments('DFD1', 'assembly', [{ kioskDocumentId: pdfId, sortOrder: 0 }])).rejects.toThrow('unique constraint');
  });
});

describe('procedure-manual document reference guards', () => {
  beforeEach(() => {
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.procedureVideoLink, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyProcedureOrderItem, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyTemplate, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyTemplateProcedureItem, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyTemplateProcedureStep, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyTemplateBolt, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyTemplateCheckItem, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'count').mockResolvedValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  it('detects directly assigned roots and refuses their unpublish and deletion', async () => {
    vi.spyOn(prisma.procedureManualAssignment, 'count').mockResolvedValue(1);
    const service = new AssemblyProcedureDocumentService({ collectGarbageForAssetIds: vi.fn() } as never);
    const usage = await service.getReferenceUsage(rootId);
    expect(usage.inProcedureManualAssignment).toBe(true);
    expect(service.isReferenced(usage)).toBe(true);
    expect(service.buildInUseMessage(usage)).toContain('要領書の機種×工程割り当て');
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: rootId }]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue(document() as never);
    await expect(service.unpublish(rootId)).rejects.toThrow('要領書の機種×工程割り当て');
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const deletion = vi.spyOn(prisma.assemblyProcedureDocument, 'delete');
    expect(await service.deleteIfUnused(rootId)).toBe('in_use');
    expect(deletion).not.toHaveBeenCalled();
  });

  it('protects the latest active published revision through its root but does not add a guard to older revisions', async () => {
    const count = vi.spyOn(prisma.procedureManualAssignment, 'count').mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findUnique').mockResolvedValue({ revisionRootId: rootId } as never);
    const latest = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockResolvedValue({ documentId: 'latest' } as never);
    const service = new AssemblyProcedureDocumentService({} as never);
    expect((await service.getReferenceUsage('latest')).inProcedureManualAssignment).toBe(true);
    expect(count).toHaveBeenLastCalledWith({ where: { assemblyProcedureDocumentId: rootId } });
    count.mockResolvedValue(0);
    expect((await service.getReferenceUsage('old')).inProcedureManualAssignment).toBe(false);
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { revisionNumber: 'desc' } }));
  });
});
