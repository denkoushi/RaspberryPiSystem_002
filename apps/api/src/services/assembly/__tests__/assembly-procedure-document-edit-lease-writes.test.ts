import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    assemblyProcedureDocumentEditLease: { findUnique: vi.fn() },
    assemblyProcedureDocument: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    assemblyProcedureAsset: { create: vi.fn() },
    assemblyProcedureDocumentPage: { create: vi.fn() },
    assemblyProcedureOverlayElement: { deleteMany: vi.fn() },
    procedureMaterial: { updateMany: vi.fn() },
    procedureVideoLink: { deleteMany: vi.fn() },
    procedureManualApproval: { create: vi.fn() }
  }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));

import { AssemblyProcedureDocumentEditLeaseService, ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { AssemblyProcedureDocumentAssetsService } from '../assembly-procedure-document-assets.service.js';
import { ProcedureMaterialPlacementService } from '../procedure-material-placement.service.js';
import { ProcedureVideoService } from '../procedure-video.service.js';
import { AssemblyTemplateAccessService } from '../assembly-template-access.service.js';

const documentId = 'document';
const writer = { holderKey: 'user:operator', holderToken: 'original-session' };
const lease = { documentId, ...writer, holderLabel: '編集太郎', acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt: new Date(Date.now() + 300_000) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(AssemblyTemplateAccessService.prototype, 'requireAccessPassword').mockResolvedValue(undefined);
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db));
  mocks.db.assemblyProcedureDocument.findUnique.mockResolvedValue({ id: documentId, status: 'DRAFT' });
  // The early check passes. Another session of the same user takes over
  // before the mutation obtains its document row lock.
  mocks.db.assemblyProcedureDocumentEditLease.findUnique.mockResolvedValue(lease);
  mocks.db.$queryRaw.mockImplementation(async () => {
    mocks.db.assemblyProcedureDocumentEditLease.findUnique.mockResolvedValue({ ...lease, holderToken: 'replacement-session' });
    return [{ id: documentId, status: 'DRAFT', isActive: true, revisionRootId: documentId, isRevisionHead: true, editVersion: 0 }];
  });
});
afterEach(() => vi.restoreAllMocks());

const mutations = {
  overlays: () => new AssemblyProcedureDocumentRevisionService().saveOverlays({ documentId, expectedEditVersion: 0, elements: [], ...writer }),
  blankPage: () => new AssemblyProcedureDocumentRevisionService().addBlankPage({ documentId, expectedEditVersion: 0, ...writer }),
  placement: () => new ProcedureMaterialPlacementService().place({ documentId, materialId: 'material', pageIndex: 0, ...writer }),
  publish: () => new AssemblyProcedureDocumentService().publish(documentId, writer),
  approvePublish: () => {
    const service = new AssemblyProcedureDocumentService();
    vi.spyOn(service, 'resolveApprover').mockResolvedValue({ id: 'reviewer' } as never);
    return service.approvePublish(documentId, { reviewerTagUid: 'tag', actorKey: writer.holderKey, expectedEditVersion: 0, ...writer });
  },
  discard: () => new AssemblyProcedureDocumentRevisionService().discardRevision({ documentId, ...writer }),
  upload: () => new AssemblyProcedureDocumentAssetsService().uploadOverlayImage({ documentId, bytes: Buffer.from('image'), contentType: 'image/png', ...writer }),
  imageRegion: () => new AssemblyProcedureDocumentAssetsService().createImageRegion({ documentId, pageIndex: 0, bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }, ...writer }),
  videos: () => new ProcedureVideoService().replacePage({ documentId, pageIndex: 0, videoIds: [], ...writer }),
  rename: () => new AssemblyProcedureDocumentService().rename(documentId, '変更後', writer),
  delete: () => new AssemblyProcedureDocumentService().deleteIfUnused(documentId, writer)
};

describe('assembly procedure mutation lease revalidation', () => {
  it.each(Object.entries(mutations))('rejects takeover after the early check for %s without persisting any change', async (_name, mutate) => {
    await new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(documentId, writer.holderKey, undefined, writer.holderToken);
    await expect(mutate()).rejects.toMatchObject({ statusCode: 409, code: ASSEMBLY_PROCEDURE_EDIT_LOCKED });
    expect(mocks.db.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(mocks.db.assemblyProcedureDocumentEditLease.findUnique).toHaveBeenCalledTimes(2);
    for (const write of [
      mocks.db.assemblyProcedureDocument.update, mocks.db.assemblyProcedureDocument.delete,
      mocks.db.assemblyProcedureAsset.create, mocks.db.assemblyProcedureDocumentPage.create,
      mocks.db.assemblyProcedureOverlayElement.deleteMany, mocks.db.procedureMaterial.updateMany,
      mocks.db.procedureVideoLink.deleteMany, mocks.db.procedureManualApproval.create
    ]) expect(write).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction connection to observe the current lease', async () => {
    const tx = { assemblyProcedureDocumentEditLease: { findUnique: vi.fn().mockResolvedValue({ ...lease, holderToken: 'replacement-session' }) } };
    await expect(new AssemblyProcedureDocumentEditLeaseService().assertCanWrite(documentId, writer.holderKey, tx as never, writer.holderToken)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.assemblyProcedureDocumentEditLease.findUnique).toHaveBeenCalledWith({ where: { documentId } });
    expect(mocks.db.assemblyProcedureDocumentEditLease.findUnique).not.toHaveBeenCalled();
  });
});
