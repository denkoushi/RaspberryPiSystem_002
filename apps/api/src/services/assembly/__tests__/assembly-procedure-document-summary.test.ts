import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';

const usage = { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'assembly', processName: '組立' };
const assignment = (id: string, documentId: string) => ({
  id, assemblyProcedureDocumentId: documentId, modelCode: usage.modelCode,
  modelCodeKey: usage.modelCodeKey, processId: usage.processId, process: { name: usage.processName }
});
const document = (id: string, revisionRootId?: string, status = 'PUBLISHED') => ({
  id, status, isActive: true, pages: [],
  revisionMetadata: revisionRootId ? { revisionRootId } : null
});

afterEach(() => vi.restoreAllMocks());

describe('assembly procedure document summary usage', () => {
  it('batches direct and root assignments, attributing roots only to the latest active published revision', async () => {
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([
      document('legacy'), document('unused'), document('root', 'root'),
      document('latest', 'root'), document('old', 'root'), document('draft', 'root', 'DRAFT'),
      document('initial', 'initial', 'DRAFT')
    ] as never);
    vi.spyOn(prisma.assemblyTemplate, 'findMany').mockResolvedValue([]);
    const assignments = vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([
      assignment('a', 'legacy'), assignment('b', 'root'), assignment('c', 'initial'), assignment('d', 'old')
    ] as never);
    const revisions = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findMany').mockResolvedValue([
      { revisionRootId: 'root', documentId: 'latest' }, { revisionRootId: 'root', documentId: 'old' }
    ] as never);
    const single = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findFirst');
    const result = await new AssemblyProcedureDocumentService({} as never).listSummary({});
    expect(result.map(doc => [doc.id, doc.manualAssignments])).toEqual([
      ['legacy', [usage]], ['unused', []], ['root', [usage]], ['latest', [usage]],
      ['old', [usage]], ['draft', []], ['initial', [usage]]
    ]);
    expect(assignments).toHaveBeenCalledOnce(); expect(revisions).toHaveBeenCalledOnce();
    expect(single).not.toHaveBeenCalled();
    expect(revisions).toHaveBeenCalledWith({
      where: { revisionRootId: { in: ['root', 'initial'] }, document: { status: 'PUBLISHED', isActive: true } },
      orderBy: { revisionNumber: 'desc' }, select: { revisionRootId: true, documentId: true }
    });
  });

  it('does not attribute root usage to an older published revision or a revision draft head', async () => {
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([
      document('old', 'root'), document('draft', 'root', 'DRAFT')
    ] as never);
    vi.spyOn(prisma.assemblyTemplate, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.procedureManualAssignment, 'findMany').mockResolvedValue([assignment('a', 'root')] as never);
    vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findMany').mockResolvedValue([
      { revisionRootId: 'root', documentId: 'latest-outside-list' }, { revisionRootId: 'root', documentId: 'old' }
    ] as never);
    const result = await new AssemblyProcedureDocumentService({} as never).listSummary({});
    expect(result.map(doc => doc.manualAssignments)).toEqual([[], []]);
  });

  it('skips assignment and revision queries for an empty list', async () => {
    vi.spyOn(prisma.assemblyProcedureDocument, 'findMany').mockResolvedValue([]);
    const assignments = vi.spyOn(prisma.procedureManualAssignment, 'findMany');
    const revisions = vi.spyOn(prisma.assemblyProcedureDocumentRevision, 'findMany');
    expect(await new AssemblyProcedureDocumentService({} as never).listSummary({})).toEqual([]);
    expect(assignments).not.toHaveBeenCalled(); expect(revisions).not.toHaveBeenCalled();
  });
});
