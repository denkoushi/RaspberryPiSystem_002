import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';

function fixture() {
  const indexes = [0, 1, 2, 3];
  const pages = indexes.map(pageIndex => ({ documentId: 'doc', pageIndex, imageRelativePath: `/${pageIndex}.png` }));
  const overlays = indexes.map(pageIndex => ({ documentId: 'doc', pageIndex }));
  const links = indexes.flatMap(pageIndex => [0, 1].map(sortOrder => ({ assemblyProcedureDocumentId: 'doc', pageIndex, sortOrder })));
  links.push({ assemblyProcedureDocumentId: 'other', pageIndex: 0, sortOrder: 0 });
  const captions = [...indexes, 4].map(pageIndex => ({ documentId: 'doc', pageIndex, outcome: 'KEPT' }));
  const text = [...indexes, 5].map(pageIndex => ({ documentId: 'doc', pageIndex, outcome: 'REVERTED' }));
  const revisionMetadata = { editVersion: 4, isRevisionHead: true };
  const document = { imageRelativePath: '/0.png' };

  const feedbackModel = (rows: typeof captions) => ({
    aggregate: vi.fn(async () => ({ _max: { pageIndex: Math.max(...rows.map(row => row.pageIndex)) } })),
    updateMany: vi.fn(async ({ where, data }) => {
      rows.filter(row => row.documentId === where.documentId && row.pageIndex === where.pageIndex)
        .forEach(row => { row.pageIndex = data.pageIndex; });
    })
  });

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'doc', status: 'DRAFT', isActive: true, revisionRootId: 'doc', isRevisionHead: true }]),
    assemblyProcedureDocumentPage: {
      findMany: vi.fn(async () => pages.map(page => ({ ...page }))),
      update: vi.fn(async ({ where, data }) => {
        const { documentId, pageIndex } = where.documentId_pageIndex;
        if (data.pageIndex < 0) throw new Error('Overlay page index must be nonnegative');
        if (pages.some(row => row.documentId === documentId && row.pageIndex === data.pageIndex)) throw new Error('Duplicate page index');
        pages.find(row => row.documentId === documentId && row.pageIndex === pageIndex)!.pageIndex = data.pageIndex;
        overlays.filter(row => row.documentId === documentId && row.pageIndex === pageIndex)
          .forEach(row => { row.pageIndex = data.pageIndex; });
      })
    },
    assemblyProcedureOverlayElement: { updateMany: vi.fn() },
    procedureVideoLink: {
      aggregate: vi.fn(async () => ({ _max: { pageIndex: Math.max(...links.map(row => row.pageIndex)) } })),
      updateMany: vi.fn(async ({ where, data }) => {
        const related = links.filter(row => row.assemblyProcedureDocumentId === where.assemblyProcedureDocumentId);
        for (const link of related.filter(row => row.pageIndex === where.pageIndex)) {
          if (related.some(row => row.pageIndex === data.pageIndex && row.sortOrder === link.sortOrder)) throw new Error('Duplicate video link order');
          link.pageIndex = data.pageIndex;
        }
      })
    },
    assemblyProcedureCaptionFeedback: feedbackModel(captions),
    assemblyProcedureTextFeedback: feedbackModel(text),
    assemblyTemplateProcedureStep: { count: vi.fn(async () => 0) },
    assemblyTemplateBolt: { count: vi.fn(async () => 0) },
    assemblyTemplateCheckItem: { count: vi.fn(async () => 0) },
    assemblyProcedureDocumentRevision: {
      findUnique: vi.fn(async () => revisionMetadata),
      update: vi.fn(async () => { revisionMetadata.editVersion += 1; })
    },
    assemblyProcedureDocument: {
      update: vi.fn(async ({ data }) => Object.assign(document, data)),
      findUnique: vi.fn(async () => ({ ...document, pages: [...pages].sort((a, b) => a.pageIndex - b.pageIndex), revisionMetadata }))
    }
  };
  return { tx, pages, overlays, links, captions, text };
}

describe('move a procedure document page', () => {
  let data: ReturnType<typeof fixture>;
  beforeEach(() => {
    data = fixture();
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: unknown) => Promise<unknown>) => work(data.tx)) as never);
    vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const move = (pageIndex: number, toPageIndex: number, expectedEditVersion = 4) =>
    new AssemblyProcedureDocumentRevisionService().movePage({
      documentId: 'doc', pageIndex, toPageIndex, accessPassword: '1234', expectedEditVersion, holderKey: 'writer', holderToken: 'lease'
    });

  it.each([
    { from: 0, to: 2, indexByOriginal: [2, 0, 1, 3], first: '/1.png' },
    { from: 2, to: 0, indexByOriginal: [1, 2, 0, 3], first: '/2.png' },
    { from: 3, to: 1, indexByOriginal: [0, 2, 3, 1], first: '/0.png' }
  ])('moves $from to $to and preserves page references', async ({ from, to, indexByOriginal, first }) => {
    const result = await move(from, to);
    expect(data.pages.map(row => row.pageIndex)).toEqual(indexByOriginal);
    expect(data.overlays.map(row => row.pageIndex)).toEqual(indexByOriginal);
    expect(data.tx.assemblyProcedureOverlayElement.updateMany).not.toHaveBeenCalled();
    expect(data.links.map(row => [row.pageIndex, row.sortOrder])).toEqual([
      ...indexByOriginal.flatMap(pageIndex => [[pageIndex, 0], [pageIndex, 1]]), [0, 0]
    ]);
    expect(data.captions.map(row => row.pageIndex)).toEqual([...indexByOriginal, 4]);
    expect(data.text.map(row => row.pageIndex)).toEqual([...indexByOriginal, 5]);
    expect(data.captions.every(row => row.outcome === 'KEPT')).toBe(true);
    expect(data.text.every(row => row.outcome === 'REVERTED')).toBe(true);
    expect(result.imageRelativePath).toBe(first);
    expect(result.pages[0].imageRelativePath).toBe(first);
    expect(result.revisionMetadata?.editVersion).toBe(5);
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledWith('doc', 'writer', data.tx, 'lease');
    expect(data.tx.assemblyTemplateProcedureStep.count).toHaveBeenCalledWith({
      where: { assemblyProcedureDocumentId: 'doc', pageIndex: { gte: Math.min(from, to), lte: Math.max(from, to) } }
    });
  });

  it.each(['assemblyTemplateProcedureStep', 'assemblyTemplateBolt', 'assemblyTemplateCheckItem'] as const)('refuses %s references before updating any rows', async model => {
    data.tx[model].count.mockResolvedValue(1);
    await expect(move(2, 0)).rejects.toMatchObject({
      statusCode: 409, message: 'このページまたは間のページがテンプレートで使われているため、並べ替えられません'
    });
    expect(data.tx.assemblyTemplateBolt.count).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([
      { assemblyProcedureDocumentId: 'doc', pageIndex: null },
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, area: { template: { procedureDocumentId: 'doc' } } }
    ]) } });
    expect(data.tx.assemblyTemplateCheckItem.count).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, template: { procedureDocumentId: 'doc' } }
    ]) } });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureDocumentRevision.update).not.toHaveBeenCalled();
  });

  it('checks both indexes and leaves an unchanged move at its original version', async () => {
    await expect(move(8, 0)).rejects.toMatchObject({ statusCode: 400 });
    await expect(move(0, 8)).rejects.toMatchObject({ statusCode: 400 });
    await expect(move(8, 8)).rejects.toMatchObject({ statusCode: 400 });
    await expect(move(2, 2)).resolves.toMatchObject({ revisionMetadata: { editVersion: 4 } });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureDocumentRevision.update).not.toHaveBeenCalled();
  });

  it('refuses a stale version before moving pages', async () => {
    await expect(move(0, 2, 3)).rejects.toMatchObject({ statusCode: 409, code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT' });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
  });
});
