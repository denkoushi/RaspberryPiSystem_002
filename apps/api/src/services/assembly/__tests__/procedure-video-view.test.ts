import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { serializeAssemblyProcedureDocumentRevision } from '../assembly-procedure-document-revision.serializer.js';
import { ProcedureManualService } from '../procedure-manual.service.js';

const now = new Date();
const links = ['READY', 'PENDING', 'PROCESSING', 'FAILED'].map((status, index) => ({ pageIndex: 0, sortOrder: index, video: { id: status, title: status, durationSeconds: 3, status, discardedAt: null } }));
const doc = { id: 'doc', name: '手順', imageRelativePath: 'image', status: 'PUBLISHED', isActive: true, publishedAt: now, createdAt: now, updatedAt: now, pages: [{ pageIndex: 0, imageRelativePath: 'image' }], overlayElements: [], revisionMetadata: null, procedureVideoLinks: links };
beforeEach(() => { vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockResolvedValue(null); });
afterEach(() => vi.restoreAllMocks());
describe('procedure-video document viewing', () => {
  it('serializes only READY active videos on the matching page', () => {
    const result = serializeAssemblyProcedureDocumentRevision({ ...doc, status: 'PUBLISHED' });
    expect(result.pages[0].videos.map((video) => video.id)).toEqual(['READY']);
    expect(serializeAssemblyProcedureDocumentRevision({ ...doc, status: 'PUBLISHED', pages: [{ pageIndex: 1, imageRelativePath: 'image' }] }).pages[0].videos).toEqual([]);
  });
  it('returns only READY videos in the manual sequence', async () => {
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([{ id: 'assign', modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'p', sortOrder: 0, label: null, assemblyProcedureDocumentId: 'doc', kioskDocumentId: null }] as never);
    vi.spyOn(prisma.procedureManualProcess, 'findFirst').mockResolvedValue({ id: 'p', subjectKind: 'MODEL' } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst').mockResolvedValue({ document: doc } as never);
    const result = await new ProcedureManualService().getAssignments('DFD1', 'p');
    expect(result.sequence.documents[0].pages[0].videos?.map((video) => video.id)).toEqual(['READY']);
  });
  it('copies video links into a new revision without changing the published links', async () => {
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: any) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'doc', status: 'PUBLISHED', isActive: true, revisionRootId: 'doc', revisionNumber: 1, isRevisionHead: true, sourceAssetId: null }]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ ...doc, procedureVideoLinks: [{ pageIndex: 0, sortOrder: 0, videoId: 'READY' }] } as never);
    vi.spyOn(prisma.assemblyProcedureDocument, 'create').mockResolvedValue({ id: 'draft' } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'update').mockResolvedValue({} as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'aggregate').mockResolvedValue({ _max: { revisionNumber: 1 } } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'create').mockResolvedValue({} as never);
    vi.spyOn(prisma.assemblyProcedureDocumentPage, 'createMany').mockResolvedValue({ count: 1 });
    const copy = vi.spyOn(prisma.procedureVideoLink, 'createMany').mockResolvedValue({ count: 1 });
    const remove = vi.spyOn(prisma.procedureVideoLink, 'deleteMany');
    await new AssemblyProcedureDocumentRevisionService({ requireAccessPassword: async () => undefined } as never, {} as never).createRevision('doc', 'pw');
    expect(copy).toHaveBeenCalledExactlyOnceWith({ data: [{ videoId: 'READY', pageIndex: 0, sortOrder: 0, assemblyProcedureDocumentId: 'draft' }] });
    expect(remove).not.toHaveBeenCalled();
  });
  it('discards only the draft video links before deleting its document', async () => {
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: any) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'draft', status: 'DRAFT', isActive: true, revisionRootId: 'doc', isRevisionHead: true, supersedesDocumentId: 'doc', editVersion: 0, sourceAssetId: null }]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue({ ...doc, pages: [], overlayElements: [], ownedAssets: [] } as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'update').mockResolvedValue({} as never);
    const remove = vi.spyOn(prisma.procedureVideoLink, 'deleteMany').mockResolvedValue({ count: 1 });
    const documentRemove = vi.spyOn(prisma.assemblyProcedureDocument, 'delete').mockResolvedValue({} as never);
    await new AssemblyProcedureDocumentRevisionService({ requireAccessPassword: async () => undefined } as never, {} as never).discardRevision({ documentId: 'draft', accessPassword: 'pw' });
    expect(remove).toHaveBeenCalledExactlyOnceWith({ where: { assemblyProcedureDocumentId: 'draft' } });
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(documentRemove.mock.invocationCallOrder[0]);
  });
  it('explains document deletion refused by video links before any removal', async () => {
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: any) => work(prisma)) as never);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: 'doc' }]);
    vi.spyOn(prisma.assemblyProcedureDocument, 'findUnique').mockResolvedValue(doc as never);
    vi.spyOn(prisma.procedureVideoLink, 'count').mockResolvedValue(1);
    const remove = vi.spyOn(prisma.assemblyProcedureDocument, 'delete');
    await expect(new AssemblyProcedureDocumentService({} as never).deleteIfUnused('doc')).rejects.toThrow('動画が紐づいている');
    expect(remove).not.toHaveBeenCalled();
  });
});
