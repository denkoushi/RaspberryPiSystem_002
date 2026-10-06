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

  it('returns all child processes and batches published, draft, revision, unavailable and PDF overview items', async () => {
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([
      { id: 'parent', parentId: null, sortOrder: 0 },
      { id: 'assembly', parentId: 'parent', sortOrder: 0 },
      { id: 'empty', parentId: 'parent', sortOrder: 1 }
    ] as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([
      assignment('revision'), assignment('initial', 'draft-root', 1), assignment('missing', 'disabled', 2),
      { ...assignment('pdf', null, 3), kioskDocumentId: pdfId, kioskDocument: { id: pdfId, title: 'PDF', displayTitle: 'キオスクPDF', enabled: true, pageCount: 2 } },
      { ...assignment('disabled-pdf', null, 4), kioskDocumentId: 'off', kioskDocument: { title: 'OFF', enabled: false, pageCount: 1 } },
      assignment('legacy', 'legacy', 5)
    ] as never);
    const revision = (revisionNumber: number, supersedesDocumentId: string | null, isRevisionHead = false) => ({ revisionRootId: rootId, revisionNumber, supersedesDocumentId, isRevisionHead });
    const query = vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([
      { ...document(), revisionMetadata: revision(1, null) },
      { ...document('v2'), revisionMetadata: revision(2, rootId) },
      { ...document('v3'), status: 'DRAFT', revisionMetadata: revision(3, 'v2', true), editLease: { holderLabel: '佐藤', acquiredAt: now, expiresAt: new Date('2099-01-01') } },
      { ...document('draft-root'), status: 'DRAFT', revisionMetadata: { revisionRootId: 'draft-root', revisionNumber: 1, supersedesDocumentId: null } },
      { ...document('disabled'), isActive: false }, document('legacy')
    ] as never);
    const single = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst');
    const result = await new ProcedureManualService().getModelOverview('ｄｆｄ１');
    expect(result).toMatchObject({ modelCode: 'ｄｆｄ１', modelCodeKey: 'DFD1' });
    expect(result.processes.map(p => [p.processId, p.count])).toEqual([['assembly', 6], ['empty', 0]]);
    expect(result.processes[1].items).toEqual([]);
    const items = result.processes[0].items;
    expect(items[0]).toEqual({ assignmentId: 'revision', sortOrder: 0, label: null, kind: 'assembly_procedure_document', documentId: 'v2', title: '公開手順', status: 'published', publishedRevisionNumber: 2,
      draftRevision: { documentId: 'v3', revisionNumber: 3, editLease: { holderLabel: '佐藤', acquiredAt: now.toISOString() } }, unavailableReason: null, pageCount: 1, thumbnailPageUrl: document().imageRelativePath });
    expect(items[1]).toMatchObject({ status: 'draft', publishedRevisionNumber: null, draftRevision: null, documentId: 'draft-root' });
    expect(items[2]).toMatchObject({ title: '公開手順', status: 'unavailable', unavailableReason: 'no_published_revision', pageCount: null, thumbnailPageUrl: null });
    expect(items[3]).toMatchObject({ kind: 'kiosk_document', title: 'キオスクPDF', status: 'published', publishedRevisionNumber: null, pageCount: 2, thumbnailPageUrl: null });
    expect(items[4]).toMatchObject({ status: 'unavailable', unavailableReason: 'disabled' });
    expect(items[5]).toMatchObject({ status: 'published', publishedRevisionNumber: 1 });
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { id: { in: [rootId, 'draft-root', 'disabled', 'legacy'] } },
      { revisionMetadata: { is: { revisionRootId: { in: [rootId, 'draft-root', 'disabled', 'legacy'] } } } }
    ] } }));
    expect(single).not.toHaveBeenCalled();
  });

  it('omits expired leases and keeps revision drafts separate from initial drafts', async () => {
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([{ id: 'assembly', parentId: 'parent' }] as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([assignment('one')] as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([
      { ...document(), status: 'DRAFT', revisionMetadata: { revisionRootId: rootId, revisionNumber: 2, supersedesDocumentId: 'old', isRevisionHead: true }, editLease: { holderLabel: '期限切れ', acquiredAt: now, expiresAt: now } }
    ] as never);
    const item = (await new ProcedureManualService().getModelOverview('DFD1')).processes[0].items[0];
    expect(item.status).toBe('unavailable');
    expect(item.draftRevision).toEqual({ documentId: rootId, revisionNumber: 2, editLease: null });
  });

  it('returns zero counts without querying documents for an unassigned model', async () => {
    vi.spyOn(prisma.procedureManualProcess, 'findMany').mockResolvedValue([{ id: 'assembly', parentId: 'parent' }] as never);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([]);
    const query = vi.spyOn(prisma.assemblyProcedureDocument, 'findMany');
    expect(await new ProcedureManualService().getModelOverview('new')).toEqual({ modelCode: 'NEW', modelCodeKey: 'NEW', processes: [{ processId: 'assembly', count: 0, items: [] }] });
    expect(query).not.toHaveBeenCalled();
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

  it.each(['retained', 'new-model', 'new-process'])('only retains an already assigned disabled PDF while removing another item (%s)', async scope => {
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'assembly' }]);
    vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ id: 'assembly' } as never);
    const assignments = vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockImplementation(async args =>
      args?.where?.modelCodeKey === 'DFD1' && args.where.processId === 'assembly'
        ? [assignment('other'), { ...assignment('disabled-pdf', null, 1), kioskDocumentId: pdfId }] as never : []);
    const pdf = vi.spyOn(prisma.kioskDocument, 'findFirst').mockImplementation(async args =>
      args?.where?.enabled === true ? null : { id: pdfId, enabled: false } as never);
    const remove = vi.spyOn(prisma.procedureManualAssignment, 'deleteMany').mockResolvedValue({ count: 2 });
    const create = vi.spyOn(prisma.procedureManualAssignment, 'createMany').mockResolvedValue({ count: 1 });
    const model = scope === 'new-model' ? 'DFD2' : 'ｄｆｄ１';
    const process = scope === 'new-process' ? 'inspection' : 'assembly';
    const save = new ProcedureManualService().replaceAssignments(model, process, [{ kioskDocumentId: pdfId, sortOrder: 0, label: 'PDF' }]);
    if (scope === 'retained') {
      await save;
      expect(pdf).toHaveBeenCalledWith({ where: { id: pdfId } });
      expect(remove).toHaveBeenCalledWith({ where: { modelCodeKey: 'DFD1', processId: 'assembly' } });
      expect(create).toHaveBeenCalledWith({ data: [expect.objectContaining({ kioskDocumentId: pdfId, assemblyProcedureDocumentId: null, sortOrder: 0, label: 'PDF' })] });
    } else {
      await expect(save).rejects.toThrow('キオスク文書が見つかりません');
      expect(pdf).toHaveBeenCalledWith({ where: { id: pdfId, enabled: true } });
      expect(remove).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    }
    expect(assignments).toHaveBeenCalledWith({ where: { modelCodeKey: scope === 'new-model' ? 'DFD2' : 'DFD1', processId: process }, select: { assemblyProcedureDocumentId: true, kioskDocumentId: true } });
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
