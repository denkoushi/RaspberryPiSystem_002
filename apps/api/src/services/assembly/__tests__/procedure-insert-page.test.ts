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
  const textFeedback = feedback.map(row => ({ ...row }));
  const revision = { revisionRootId: 'doc', isRevisionHead: true, editVersion: 4 };
  const source = {
    id: 'source',
    pages: [0, 1, 2].map(pageIndex => ({ pageIndex, imageRelativePath: `/source-${pageIndex}.png` })),
    overlayElements: [
      { id: 'source-image', pageIndex: 0, kind: 'IMAGE', assetId: 'shared-asset', zIndex: 5 },
      { id: 'source-text', pageIndex: 2, kind: 'TEXT', text: '本文', zIndex: 3 }
    ],
    procedureVideoLinks: [{ id: 'source-link', pageIndex: 2, videoId: 'video', sceneId: 'scene', sortOrder: 1 }]
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'doc', status: 'DRAFT', isActive: true, revisionRootId: 'doc', isRevisionHead: true, editVersion: 4 }, { id: source.id, status: 'PUBLISHED', isActive: true }]),
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
      create: vi.fn(async ({ data }) => { pages.push(data); }),
      createMany: vi.fn(async ({ data }) => { pages.push(...data); })
    },
    assemblyProcedureOverlayElement: { updateMany: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    procedureMaterial: { updateMany: vi.fn() },
    procedureVideoLink: {
      createMany: vi.fn(),
      findMany: vi.fn(async ({ where }) => links.filter(link => link.pageIndex > where.pageIndex.gt).sort((a, b) => b.pageIndex - a.pageIndex).map(link => ({ ...link }))),
      update: vi.fn(async ({ where, data }) => {
        if (links.some(link => link.pageIndex === data.pageIndex)) throw new Error('Unique video link constraint');
        links.find(link => link.id === where.id)!.pageIndex = data.pageIndex;
      })
    },
    assemblyProcedureTextFeedback: {
      updateMany: vi.fn(async ({ where, data }) => { textFeedback.filter(row => row.documentId === where.documentId && row.pageIndex > where.pageIndex.gt).forEach(row => { row.pageIndex += data.pageIndex.increment; }); })
    },
    assemblyProcedureCaptionFeedback: {
      updateMany: vi.fn(async ({ where, data }) => { feedback.filter(row => row.documentId === where.documentId && row.pageIndex > where.pageIndex.gt).forEach(row => { row.pageIndex += data.pageIndex.increment; }); })
    },
    assemblyTemplateProcedureStep: { count: vi.fn(async () => 0) },
    assemblyTemplateBolt: { count: vi.fn(async () => 0) },
    assemblyTemplateCheckItem: { count: vi.fn(async () => 0) },
    assemblyProcedureDocumentRevision: { findUnique: vi.fn(async () => revision), update: vi.fn(async () => { revision.editVersion++; }) },
    assemblyProcedureDocument: {
      findUnique: vi.fn(async ({ where }) => where.id === source.id ? source : { pages, revisionMetadata: revision }),
      update: vi.fn()
    }
  };
  return { tx, source, pages, overlays, links, feedback, textFeedback, revision };
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
    expect(data.textFeedback.map(row => row.pageIndex)).toEqual([0, 2, 3, 1]);
    expect(data.tx.assemblyProcedureTextFeedback.updateMany).toHaveBeenCalledOnce();
    expect(data.feedback.map(row => row.pageIndex)).toEqual([0, 2, 3, 1]);
    expect(data.tx.assemblyProcedureDocumentPage.update.mock.calls.map(([input]) => input.where.documentId_pageIndex.pageIndex)).toEqual([2, 1]);
    expect(data.tx.assemblyProcedureOverlayElement.updateMany).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureOverlayElement.update).not.toHaveBeenCalled();
    expect(data.revision.editVersion).toBe(5);
    expect(AssemblyTemplateAccessService.prototype.requireAccessPassword).not.toHaveBeenCalled();
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
    expect(data.tx.assemblyProcedureTextFeedback.updateMany).not.toHaveBeenCalled();
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
  const importPages = (extra = {}) => new AssemblyProcedureDocumentRevisionService().importPages({
    documentId: 'doc', sourceDocumentId: 'source', sourcePageIndexes: [2, 0], expectedEditVersion: 4,
    accessPassword: '1234', holderKey: 'writer', holderToken: 'lease', ...extra
  });

  it.each([undefined, -1, 0, 2])('imports in selection order at position %s, shifting only later rows', async position => {
    const result = await importPages({ afterPageIndex: position });
    const afterPageIndex = position ?? -1;
    const importedIndex = afterPageIndex + 1;
    const shift = (index: number) => index > afterPageIndex ? index + 2 : index;
    expect(result.revisionMetadata?.editVersion).toBe(5);
    expect(data.pages.filter(page => page.imageRelativePath.startsWith('/source')).sort((a, b) => a.pageIndex - b.pageIndex))
      .toEqual([
        { documentId: 'doc', pageIndex: importedIndex, imageRelativePath: '/source-2.png' },
        { documentId: 'doc', pageIndex: importedIndex + 1, imageRelativePath: '/source-0.png' }
      ]);
    for (const rows of [data.overlays, data.links, data.feedback.slice(0, 3), data.textFeedback.slice(0, 3)]) {
      expect(rows.map(row => row.pageIndex)).toEqual([0, 1, 2].map(shift));
    }
    expect(data.tx.assemblyProcedureOverlayElement.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ documentId: 'doc', pageIndex: importedIndex + 1, assetId: 'shared-asset' }),
      expect.objectContaining({ documentId: 'doc', pageIndex: importedIndex, text: '本文', zIndex: 3 })
    ] });
    const copies = data.tx.assemblyProcedureOverlayElement.createMany.mock.calls[0][0].data;
    expect(copies.map((row: { id: string }) => row.id)).toEqual([expect.any(String), expect.any(String)]);
    expect(copies[0].id).not.toBe('source-image');
    expect(copies[1].id).not.toBe('source-text');
    expect(data.tx.procedureVideoLink.createMany).toHaveBeenCalledWith({ data: [
      { assemblyProcedureDocumentId: 'doc', pageIndex: importedIndex, videoId: 'video', sceneId: 'scene', sortOrder: 1 }
    ] });
    if (afterPageIndex === -1) {
      expect(data.tx.assemblyProcedureDocument.update).toHaveBeenCalledWith({ where: { id: 'doc' }, data: { imageRelativePath: '/source-2.png' } });
    } else expect(data.tx.assemblyProcedureDocument.update).not.toHaveBeenCalled();
    expect(data.tx.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(data.source.overlayElements.map(row => row.pageIndex)).toEqual([0, 2]);
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledExactlyOnceWith('doc', 'writer', data.tx, 'lease');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it.each([
    { sourceDocumentId: 'doc' }, { sourcePageIndexes: [] }, { sourcePageIndexes: [0, 0] },
    { sourcePageIndexes: [-1] }, { sourcePageIndexes: [3] }, { afterPageIndex: 3 }, { afterPageIndex: -2 }
  ])('rejects invalid import input %j before writing', async extra => {
    await expect(importPages(extra)).rejects.toMatchObject({ statusCode: 400 });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureDocumentPage.createMany).not.toHaveBeenCalled();
  });

  it.each(['assemblyTemplateProcedureStep', 'assemblyTemplateBolt', 'assemblyTemplateCheckItem'] as const)('refuses an import before a %s reference', async model => {
    data.tx[model].count.mockResolvedValue(1);
    await expect(importPages()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('テンプレート') });
    expect(data.tx.assemblyProcedureDocumentPage.update).not.toHaveBeenCalled();
    expect(data.tx.assemblyProcedureDocumentPage.createMany).not.toHaveBeenCalled();
  });

  it('rejects an import with a stale version, outdated draft or lost lease', async () => {
    await expect(importPages({ expectedEditVersion: 3 })).rejects.toMatchObject({ statusCode: 409, code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT' });
    data.revision.isRevisionHead = false;
    await expect(importPages()).rejects.toMatchObject({ statusCode: 409 });
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValue(new Error('lease lost'));
    await expect(importPages()).rejects.toThrow('lease lost');
    expect(data.tx.assemblyProcedureDocumentPage.createMany).not.toHaveBeenCalled();
  });

});
