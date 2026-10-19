import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  assemblyProcedureDocument: { findUnique: vi.fn() },
  assemblyProcedureDocumentPage: { findMany: vi.fn() },
  assemblyProcedureOverlayElement: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  assemblyProcedureDocumentRevision: { update: vi.fn() },
  assemblyProcedureCaptionFeedback: { findMany: vi.fn(), update: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: db }));

import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentEditLeaseService } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';

const documentId = 'draft';
const saved = { id: documentId };
const caption = { id: 'caption', kind: 'TEXT' as const, pageIndex: 0, text: 'AI line', zIndex: 0,
  bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.3, heightRatio: 0.1 } };
const feedback = { id: 'feedback', elementId: caption.id, aiText: 'AI line', finalText: null, outcome: 'PROPOSED' };
const save = (elements = [caption], appliedCaptionElementIds?: string[]) => new AssemblyProcedureDocumentRevisionService().saveOverlays({
  documentId, expectedEditVersion: 0, elements, appliedCaptionElementIds
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
  vi.spyOn(AssemblyProcedureDocumentEditLeaseService.prototype, 'assertCanWrite').mockResolvedValue(undefined);
  db.$transaction.mockImplementation(async work => work(db));
  db.$queryRaw.mockResolvedValue([{ id: documentId, status: 'DRAFT', isActive: true, revisionRootId: documentId, isRevisionHead: true, editVersion: 0 }]);
  db.assemblyProcedureDocumentPage.findMany.mockResolvedValue([{ pageIndex: 0 }]);
  db.assemblyProcedureOverlayElement.findMany.mockResolvedValue([]);
  db.assemblyProcedureDocument.findUnique.mockResolvedValue(saved);
  db.assemblyProcedureCaptionFeedback.findMany.mockResolvedValue([feedback]);
});
afterEach(() => vi.restoreAllMocks());

describe('caption feedback after overlay save', () => {
  it.each([undefined, ['caption']])('records present saved text with applied ids %j', async ids => {
    await expect(save([caption], ids)).resolves.toBe(saved);
    expect(db.assemblyProcedureCaptionFeedback.findMany).toHaveBeenCalledWith({ where: { documentId } });
    expect(db.assemblyProcedureCaptionFeedback.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'feedback' }, data: { outcome: 'KEPT', finalText: 'AI line', resolvedAt: expect.any(Date) } });
    expect(db.assemblyProcedureOverlayElement.createMany).toHaveBeenCalled();
    expect(db.$transaction.mock.invocationCallOrder[0]).toBeLessThan(db.assemblyProcedureCaptionFeedback.findMany.mock.invocationCallOrder[0]);
  });
  it('records the normalized edited text', async () => {
    await save([{ ...caption, text: '  Human line  ' }]);
    expect(db.assemblyProcedureCaptionFeedback.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: 'EDITED', finalText: 'Human line', resolvedAt: expect.any(Date) } }));
  });
  it('does not mistake a cancelled proposal for deletion when old clients omit ids', async () => {
    await save([]);
    expect(db.assemblyProcedureCaptionFeedback.update).not.toHaveBeenCalled();
  });
  it('records applied then absent proposals as deleted', async () => {
    await save([], ['caption']);
    expect(db.assemblyProcedureCaptionFeedback.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: 'DELETED', finalText: null, resolvedAt: expect.any(Date) } }));
  });
  it('records previously saved captions as deleted without ids', async () => {
    db.assemblyProcedureCaptionFeedback.findMany.mockResolvedValue([{ ...feedback, outcome: 'EDITED', finalText: 'human' }]);
    await save([]);
    expect(db.assemblyProcedureCaptionFeedback.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: 'DELETED', finalText: null, resolvedAt: expect.any(Date) } }));
  });
  it('restores a deleted caption on undo', async () => {
    db.assemblyProcedureCaptionFeedback.findMany.mockResolvedValue([{ ...feedback, outcome: 'DELETED' }]);
    await save();
    expect(db.assemblyProcedureCaptionFeedback.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outcome: 'KEPT', finalText: 'AI line', resolvedAt: expect.any(Date) } }));
  });
  it('does not update resolvedAt when nothing changed', async () => {
    db.assemblyProcedureCaptionFeedback.findMany.mockResolvedValue([{ ...feedback, outcome: 'KEPT', finalText: 'AI line' }]);
    await save();
    expect(db.assemblyProcedureCaptionFeedback.update).not.toHaveBeenCalled();
  });
  it.each(['findMany', 'update'] as const)('keeps a successful overlay save when feedback %s fails', async operation => {
    db.assemblyProcedureCaptionFeedback[operation].mockRejectedValue(new Error('recording failed'));
    await expect(save()).resolves.toBe(saved);
    expect(db.assemblyProcedureOverlayElement.createMany).toHaveBeenCalled();
  });
  it('does not record when the overlay transaction fails', async () => {
    db.assemblyProcedureOverlayElement.createMany.mockRejectedValue(new Error('save failed'));
    await expect(save()).rejects.toThrow('save failed');
    expect(db.assemblyProcedureCaptionFeedback.findMany).not.toHaveBeenCalled();
  });
});
