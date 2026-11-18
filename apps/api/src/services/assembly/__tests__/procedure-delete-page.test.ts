import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These tests use synthetic configuration and never load local credentials.
vi.mock('../../../config/env/load-dotenv.js', () => ({}));

import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { AssemblyProcedureImageStorage } from '../../../lib/assembly-procedure-image-storage.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyProcedureAssetGcService } from '../../assembly-procedure-assets/assembly-procedure-asset-gc.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';

function fixture() {
  const pages = [0, 1, 2].map(pageIndex => ({ documentId: 'doc', pageIndex, imageRelativePath: `/${pageIndex}.png` }));
  const overlays = [0, 1, 2].map(pageIndex => ({ documentId: 'doc', pageIndex, id: `overlay-${pageIndex}` }));
  overlays.push({ documentId: 'other', pageIndex: 0, id: 'other-overlay' });
  const links = [0, 1, 2].flatMap(pageIndex => [0, 1].map(sortOrder => ({ assemblyProcedureDocumentId: 'doc', pageIndex, sortOrder, id: `${pageIndex}-${sortOrder}` })));
  links.push({ assemblyProcedureDocumentId: 'other', pageIndex: 0, sortOrder: 0, id: 'other-link' });
  const feedbackRow = (documentId: string, pageIndex: number) => ({ id: `${documentId}-${pageIndex}`, elementId: `element-${pageIndex}`, createdAt: new Date('2026-01-01'), documentId, pageIndex, outcome: 'KEPT', aiText: 'ai', originalText: 'original', finalText: 'ai' as string | null, resolvedAt: null as Date | null });
  const feedback = [0, 1, 2].map(pageIndex => feedbackRow('doc', pageIndex));
  feedback.push(feedbackRow('other', 1));
  const textFeedback = feedback.map(row => ({ ...row }));
  const revision = { editVersion: 4, isRevisionHead: true };
  const document = { imageRelativePath: '/0.png' };
  const remove = <T extends object>(rows: T[], where: Partial<T>) => {
    for (let i = rows.length - 1; i >= 0; i--) if (Object.entries(where).every(([key, value]) => rows[i][key as keyof T] === value)) rows.splice(i, 1);
  };
  const feedbackModel = (rows: typeof feedback) => ({
    findMany: vi.fn(async ({ where, orderBy }) => {
      const result = rows.filter(row => row.documentId === where.documentId && row.pageIndex === where.pageIndex).map(row => ({ ...row }));
      return orderBy ? result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)) : result;
    }),
    update: vi.fn(async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id)!, data)),
    updateMany: vi.fn(async ({ where, data }) => rows.filter(row => row.documentId === where.documentId && row.pageIndex > where.pageIndex.gt).forEach(row => { row.pageIndex -= data.pageIndex.decrement; }))
  });
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'doc', status: 'DRAFT', isActive: true, revisionRootId: 'doc', isRevisionHead: true, editVersion: 4 }]),
    assemblyProcedureDocumentPage: {
      findMany: vi.fn(async () => pages.map(page => ({ ...page }))),
      delete: vi.fn(async ({ where }) => {
        const target = where.documentId_pageIndex;
        if (overlays.some(row => row.documentId === target.documentId && row.pageIndex === target.pageIndex)) throw new Error('Overlay FK restrict');
        remove(pages, target);
      }),
      update: vi.fn(async ({ where, data }) => {
        const before = where.documentId_pageIndex.pageIndex;
        if (pages.some(page => page.pageIndex === data.pageIndex)) throw new Error('Unique page constraint');
        pages.find(page => page.pageIndex === before)!.pageIndex = data.pageIndex;
        overlays.filter(row => row.documentId === 'doc' && row.pageIndex === before).forEach(row => { row.pageIndex = data.pageIndex; });
      })
    },
    assemblyProcedureOverlayElement: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(async ({ where }) => remove(overlays, where)), updateMany: vi.fn() },
    procedureVideoLink: {
      deleteMany: vi.fn(async ({ where }) => remove(links, where)),
      findMany: vi.fn(async ({ where }) => links.filter(row => row.assemblyProcedureDocumentId === where.assemblyProcedureDocumentId && row.pageIndex > where.pageIndex.gt).map(row => ({ ...row }))),
      update: vi.fn(async ({ where, data }) => {
        const link = links.find(row => row.id === where.id)!;
        if (links.some(row => row.assemblyProcedureDocumentId === 'doc' && row.pageIndex === data.pageIndex && row.sortOrder === link.sortOrder)) throw new Error('Unique video link constraint');
        link.pageIndex = data.pageIndex;
      })
    },
    assemblyProcedureCaptionFeedback: feedbackModel(feedback),
    assemblyProcedureTextFeedback: feedbackModel(textFeedback),
    assemblyTemplateProcedureStep: { count: vi.fn(async () => 0) },
    assemblyTemplateBolt: { count: vi.fn(async () => 0) },
    assemblyTemplateCheckItem: { count: vi.fn(async () => 0) },
    assemblyProcedureDocumentRevision: { findUnique: vi.fn(async (): Promise<typeof revision | null> => revision), update: vi.fn(async () => { revision.editVersion++; }) },
    assemblyProcedureDocument: {
      update: vi.fn(async ({ data }) => Object.assign(document, data)),
      findUnique: vi.fn(async () => ({ ...document, pages, revisionMetadata: revision }))
    }
  };
  return { tx, pages, overlays, links, feedback, textFeedback, revision, document };
}

describe('delete a procedure page', () => {
  let data: ReturnType<typeof fixture>;
  beforeEach(() => {
    data = fixture();
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: unknown) => Promise<unknown>) => work(data.tx)) as never);
    vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
    vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
    vi.spyOn(AssemblyProcedureAssetGcService.prototype, 'collect').mockResolvedValue({} as never);
    vi.spyOn(AssemblyProcedureImageStorage, 'deleteImage').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());
  const deletePage = (extra = {}) => new AssemblyProcedureDocumentRevisionService().deletePage({
    documentId: 'doc', pageIndex: 0, accessPassword: '1234', expectedEditVersion: 4, holderKey: 'writer', holderToken: 'lease', ...extra
  });

  it.each([0, 1, 2])('deletes page %i, compacts related rows once, and preserves other documents and files', async pageIndex => {
    const result = await deletePage({ pageIndex });
    expect(data.pages.map(row => row.pageIndex)).toEqual([0, 1]);
    expect(data.overlays.filter(row => row.documentId === 'doc').map(row => row.pageIndex)).toEqual([0, 1]);
    expect(data.overlays.at(-1)).toEqual({ documentId: 'other', pageIndex: 0, id: 'other-overlay' });
    expect(data.links.filter(row => row.assemblyProcedureDocumentId === 'doc').map(row => row.pageIndex)).toEqual([0, 0, 1, 1]);
    expect(data.links.at(-1)?.id).toBe('other-link');
    // Learning records stay; the deleted page's rows are resolved like a removed element.
    expect(data.feedback.filter(row => row.id !== `doc-${pageIndex}`).map(row => row.pageIndex)).toEqual([0, 1, 1]);
    expect(data.feedback.find(row => row.id === `doc-${pageIndex}`)).toMatchObject({ outcome: 'DELETED', finalText: null });
    expect(data.textFeedback.find(row => row.id === `doc-${pageIndex}`)).toMatchObject({ outcome: 'REVERTED', finalText: null });
    expect(data.feedback.filter(row => row.id !== `doc-${pageIndex}`).every(row => row.outcome === 'KEPT')).toBe(true);
    expect(data.tx.assemblyProcedureDocumentPage.update.mock.calls.map(([input]) => input.where.documentId_pageIndex.pageIndex)).toEqual([0, 1, 2].filter(index => index > pageIndex));
    expect(data.tx.assemblyProcedureOverlayElement.updateMany).not.toHaveBeenCalled();
    expect(data.document.imageRelativePath).toBe(pageIndex === 0 ? '/1.png' : '/0.png');
    expect(result.revisionMetadata.editVersion).toBe(5);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(AssemblyProcedureImageStorage.deleteImage).not.toHaveBeenCalled();
    expect(AssemblyTemplateAccessService.prototype.requireAccessPassword).toHaveBeenCalledWith('1234', expect.objectContaining({ holderKey: 'writer' }));
    expect(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).toHaveBeenCalledWith('doc', 'writer', data.tx, 'lease');
  });
  it('resolves only the latest text feedback per element, breaking createdAt ties by id', async () => {
    const original = data.textFeedback[0];
    const newer = { ...original, id: 'newer-a', createdAt: new Date('2026-02-01') };
    const latest = { ...newer, id: 'newer-z' };
    const otherElement = { ...latest, id: 'other-element', elementId: 'different-element' };
    data.textFeedback.push(newer, latest, otherElement);
    await deletePage();
    expect(data.tx.assemblyProcedureTextFeedback.findMany).toHaveBeenCalledWith({ where: { documentId: 'doc', pageIndex: 0 }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(data.tx.assemblyProcedureTextFeedback.update.mock.calls.map(([input]) => input.where.id).sort()).toEqual(['newer-z', 'other-element']);
    expect(original).toMatchObject({ outcome: 'KEPT', resolvedAt: null });
    expect(newer).toMatchObject({ outcome: 'KEPT', resolvedAt: null });
    expect(latest).toMatchObject({ outcome: 'REVERTED', finalText: null, resolvedAt: expect.any(Date) });
  });

  it('collects detached overlay assets after the transaction with the existing GC policy', async () => {
    data.tx.assemblyProcedureOverlayElement.findMany.mockResolvedValue([{ assetId: 'asset' }, { assetId: 'asset' }, { assetId: null }]);
    await deletePage({ pageIndex: 1 });
    expect(data.tx.assemblyProcedureOverlayElement.findMany).toHaveBeenCalledWith({ where: { documentId: 'doc', pageIndex: 1, kind: 'IMAGE' }, select: { assetId: true } });
    expect(AssemblyProcedureAssetGcService.prototype.collect).toHaveBeenCalledExactlyOnceWith({ candidateAssetIds: ['asset'], minAgeMs: 0 });
    expect(vi.mocked(AssemblyProcedureAssetGcService.prototype.collect).mock.invocationCallOrder[0]).toBeGreaterThan(data.tx.assemblyProcedureDocument.findUnique.mock.invocationCallOrder[0]);
  });

  it('does not collect assets when the deletion transaction fails', async () => {
    data.tx.assemblyProcedureOverlayElement.findMany.mockResolvedValue([{ assetId: 'asset' }]);
    data.tx.assemblyProcedureDocument.findUnique.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(deletePage()).rejects.toThrow('transaction failed');
    expect(AssemblyProcedureAssetGcService.prototype.collect).not.toHaveBeenCalled();
  });

  it.each(['assemblyTemplateProcedureStep', 'assemblyTemplateBolt', 'assemblyTemplateCheckItem'] as const)('refuses current or later %s references before writing', async model => {
    data.tx[model].count.mockResolvedValue(1);
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('テンプレート') });
    const reference = { assemblyProcedureDocumentId: 'doc', pageIndex: { gte: 0 } };
    if (model === 'assemblyTemplateProcedureStep') expect(data.tx[model].count).toHaveBeenCalledWith({ where: reference });
    else expect(data.tx[model].count).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([reference]) } });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
  it('includes legacy markers pinned to the default first page in the reference checks', async () => {
    data.tx.assemblyTemplateBolt.count.mockResolvedValue(1);
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 409 });
    expect(data.tx.assemblyTemplateBolt.count).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([
      { assemblyProcedureDocumentId: 'doc', pageIndex: null },
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, area: { template: { procedureDocumentId: 'doc' } } }
    ]) } });
    expect(data.tx.assemblyTemplateCheckItem.count).toHaveBeenCalledWith({ where: { OR: expect.arrayContaining([
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, template: { procedureDocumentId: 'doc' } }
    ]) } });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses the last page and a nonexistent page without writing', async () => {
    data.pages.splice(1);
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 409, message: '最後の1ページは削除できません' });
    await expect(deletePage({ pageIndex: 9 })).rejects.toMatchObject({ statusCode: 400, message: '削除するページが存在しません' });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses a stale edit version without writing', async () => {
    await expect(deletePage({ expectedEditVersion: 3 })).rejects.toMatchObject({ statusCode: 409, code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT' });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
  it.each([{ status: 'PUBLISHED' }, { isRevisionHead: false }, { isActive: false }, { revisionRootId: null }])('refuses a noneditable document %j', async overrides => {
    data.tx.$queryRaw.mockResolvedValue([{ id: 'doc', status: 'DRAFT', isActive: true, ...overrides }]);
    if ('revisionRootId' in overrides) data.tx.assemblyProcedureDocumentRevision.findUnique.mockResolvedValue(null);
    if ('isRevisionHead' in overrides) data.revision.isRevisionHead = false;
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 409 });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
  it('refuses invalid page indexes and versions', async () => {
    for (const extra of [{ pageIndex: -1 }, { pageIndex: 0.5 }, { expectedEditVersion: -1 }, { expectedEditVersion: undefined }]) await expect(deletePage(extra)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('checks password and reservation before writing', async () => {
    vi.mocked(AssemblyTemplateAccessService.prototype.requireAccessPassword).mockRejectedValueOnce(new ApiError(403, 'パスワードが違います'));
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    vi.mocked(AssemblyProcedureDocumentEditLeaseService.prototype.assertCanWrite).mockRejectedValueOnce(new ApiError(409, '予約がありません'));
    await expect(deletePage()).rejects.toMatchObject({ statusCode: 409 });
    expect(data.tx.assemblyProcedureOverlayElement.deleteMany).not.toHaveBeenCalled();
  });
});
