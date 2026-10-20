import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureImageStorage } from '../../../lib/assembly-procedure-image-storage.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';
import * as blankPage from '../assembly-procedure-document-blank.service.js';

function fixture() {
  const pages = [0, 1, 2].map(pageIndex => ({ documentId: 'doc', pageIndex, imageRelativePath: `/${pageIndex}.png` }));
  const overlays = [0, 1, 2].map(pageIndex => ({ documentId: 'doc', pageIndex, id: `overlay-${pageIndex}` }));
  const links = [0, 1, 2].map(pageIndex => ({ assemblyProcedureDocumentId: 'doc', pageIndex, sortOrder: 0, id: `link-${pageIndex}` }));
  const feedback = [0, 1, 2].map(pageIndex => ({ documentId: 'doc', pageIndex }));
  feedback.push({ documentId: 'other', pageIndex: 1 });
  const revision = { editVersion: 4 };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'doc', status: 'DRAFT', isActive: true, revisionRootId: 'doc', isRevisionHead: true, editVersion: 4 }]),
    assemblyProcedureDocumentPage: {
      aggregate: vi.fn(async () => ({ _max: { pageIndex: 2 } })),
      findUnique: vi.fn(async ({ where }) => pages.find(page => page.pageIndex === where.documentId_pageIndex.pageIndex)),
      findMany: vi.fn(async ({ where }) => pages.filter(page => page.pageIndex > where.pageIndex.gt).sort((a, b) => b.pageIndex - a.pageIndex).map(page => ({ ...page }))),
      update: vi.fn(async ({ where, data }) => {
        const before = where.documentId_pageIndex.pageIndex;
        if (pages.some(page => page.pageIndex === data.pageIndex)) throw new Error('Unique page constraint');
        pages.find(page => page.pageIndex === before)!.pageIndex = data.pageIndex;
        // Model the composite FK's ON UPDATE CASCADE; the service must not write overlays.
        overlays.filter(element => element.pageIndex === before).forEach(element => { element.pageIndex = data.pageIndex; });
      }),
      create: vi.fn(async ({ data }) => { pages.push(data); })
    },
    assemblyProcedureOverlayElement: { updateMany: vi.fn(), update: vi.fn() },
    procedureVideoLink: {
      findMany: vi.fn(async ({ where }) => links.filter(link => link.pageIndex > where.pageIndex.gt).sort((a, b) => b.pageIndex - a.pageIndex).map(link => ({ ...link }))),
      update: vi.fn(async ({ where, data }) => {
        if (links.some(link => link.pageIndex === data.pageIndex)) throw new Error('Unique video link constraint');
        links.find(link => link.id === where.id)!.pageIndex = data.pageIndex;
      })
    },
    assemblyProcedureCaptionFeedback: {
      updateMany: vi.fn(async ({ where, data }) => { feedback.filter(row => row.documentId === where.documentId && row.pageIndex > where.pageIndex.gt).forEach(row => { row.pageIndex += data.pageIndex.increment; }); })
    },
    assemblyTemplateProcedureStep: { count: vi.fn(async () => 0) },
    assemblyTemplateBolt: { count: vi.fn(async () => 0) },
    assemblyTemplateCheckItem: { count: vi.fn(async () => 0) },
    assemblyProcedureDocumentRevision: { update: vi.fn(async () => { revision.editVersion++; }) },
    assemblyProcedureDocument: { findUnique: vi.fn(async () => ({ pages, revisionMetadata: revision })) }
  };
  return { tx, pages, overlays, links, feedback, revision };
}

describe('insert a blank procedure page', () => {
  let data: ReturnType<typeof fixture>;
  beforeEach(() => {
    data = fixture();
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: unknown) => Promise<unknown>) => work(data.tx)) as never);
    vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
    vi.spyOn(blankPage, 'saveBlankProcedurePage').mockResolvedValue({ relativeUrl: '/blank.png' } as never);
    vi.spyOn(AssemblyProcedureImageStorage, 'deleteImage').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  const insert = (extra = {}) => new AssemblyProcedureDocumentRevisionService().addBlankPage({
    documentId: 'doc', accessPassword: '1234', expectedEditVersion: 4, afterPageIndex: 0, holderKey: 'writer', holderToken: 'lease', ...extra
  });

  it('shifts later pages in descending order, cascades overlays, and shifts links and feedback once', async () => {
    await insert();
    expect(data.pages.map(page => page.pageIndex)).toEqual([0, 2, 3, 1]);
    expect(data.overlays.map(element => element.pageIndex)).toEqual([0, 2, 3]);
    expect(data.links.map(link => link.pageIndex)).toEqual([0, 2, 3]);
    expect(data.feedback.map(row => row.pageIndex)).toEqual([0, 2, 3, 1]);
    expect(data.tx.assemblyProcedureDocumentPage.update.mock.calls.map(([input]) => input.where.documentId_pageIndex.pageIndex)).toEqual([2, 1]);
    expect(data.tx.assemblyProcedureOverlayElement.updateMany).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureOverlayElement.update).not.toHaveBeenCalled();
    expect(data.revision.editVersion).toBe(5);
    expect(AssemblyTemplateAccessService.prototype.requireAccessPassword).toHaveBeenCalledWith('1234');
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledWith('doc', 'writer', data.tx, 'lease');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(blankPage.saveBlankProcedurePage).toHaveBeenCalledWith('/0.png');
  });
  it.each(['assemblyTemplateProcedureStep', 'assemblyTemplateBolt', 'assemblyTemplateCheckItem'] as const)('refuses a later %s reference before writing', async model => {
    data.tx[model].count.mockResolvedValue(1);
    await expect(insert()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('テンプレート') });
    expect(data.tx[model].count).toHaveBeenCalledWith({ where: { assemblyProcedureDocumentId: 'doc', pageIndex: { gt: 0 } } });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(blankPage.saveBlankProcedurePage).not.toHaveBeenCalled();
  });
  it('refuses a stale edit version before writing', async () => {
    await expect(insert({ expectedEditVersion: 3 })).rejects.toMatchObject({ statusCode: 409, code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT' });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(blankPage.saveBlankProcedurePage).not.toHaveBeenCalled();
  });
  it('rejects a missing target and keeps append behavior without afterPageIndex', async () => {
    await expect(insert({ afterPageIndex: 8 })).rejects.toMatchObject({ statusCode: 400 });
    await insert({ afterPageIndex: undefined });
    expect(data.pages.map(page => page.pageIndex)).toEqual([0, 1, 2, 3]);
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(data.tx.procedureVideoLink.update).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureCaptionFeedback.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a non-head revision and a lost lease before writing', async () => {
    data.tx.$queryRaw.mockResolvedValue([{ id: 'doc', status: 'PUBLISHED', isActive: true, revisionRootId: 'doc', isRevisionHead: true, editVersion: 4 }]);
    await expect(insert()).rejects.toMatchObject({ statusCode: 409 });
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValue(new Error('lease lost'));
    await expect(insert()).rejects.toThrow('lease lost');
    expect(blankPage.saveBlankProcedurePage).not.toHaveBeenCalled();
  });
  it('creates an inserted page with the source dimensions and retains A4 for ordinary append', async () => {
    vi.mocked(blankPage.saveBlankProcedurePage).mockRestore();
    const buffer = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#ffffff' } }).png().toBuffer();
    vi.spyOn(AssemblyProcedureImageStorage, 'readImage').mockResolvedValue({ buffer } as never);
    const save = vi.spyOn(AssemblyProcedureImageStorage, 'saveImage').mockResolvedValue({ relativeUrl: '/blank.png' } as never);
    await blankPage.saveBlankProcedurePage('/source.png');
    expect(await sharp(save.mock.calls[0][0]).metadata()).toMatchObject({ width: 1600, height: 900 });
    await blankPage.saveBlankProcedurePage();
    expect(await sharp(save.mock.calls[1][0]).metadata()).toMatchObject({ width: 1240, height: 1754 });
  });
});
