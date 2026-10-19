import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    assemblyProcedureDocumentEditLease: { findUnique: vi.fn().mockResolvedValue(null) },
    assemblyProcedureDocument: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    assemblyProcedureDocumentRevision: { create: vi.fn(), update: vi.fn() },
    assemblyProcedureDocumentPage: { aggregate: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    assemblyProcedureOverlayElement: { aggregate: vi.fn(), createMany: vi.fn() },
    assemblyProcedureAsset: { create: vi.fn(), deleteMany: vi.fn() },
    procedureManualProcess: { findFirst: vi.fn() },
    procedureManualAssignment: { findMany: vi.fn(), create: vi.fn() },
    procedureMaterial: { findUnique: vi.fn(), updateMany: vi.fn() },
  };
  return { db, saveImage: vi.fn(), deleteImage: vi.fn(), readImage: vi.fn(), assetSave: vi.fn(), assetDelete: vi.fn() };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../../../lib/assembly-procedure-image-storage.js', () => ({ AssemblyProcedureImageStorage: { saveImage: mocks.saveImage, deleteImage: mocks.deleteImage, readImage: mocks.readImage } }));
vi.mock('../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: {} }) }));
vi.mock('../../assembly-procedure-assets/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../assembly-procedure-assets/index.js')>(),
  getAssemblyProcedureAssetStorage: () => ({ save: mocks.assetSave, delete: mocks.assetDelete }),
  getAssemblyProcedureAssetGcService: () => ({ collect: vi.fn() }),
}));

import { AssemblyProcedureDocumentBlankService } from '../assembly-procedure-document-blank.service.js';
import { AssemblyProcedureDocumentRevisionService } from '../assembly-procedure-document-revision.service.js';
import { AssemblyProcedureDocumentAssetsService } from '../assembly-procedure-document-assets.service.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';
import { serializeAssemblyProcedureDocumentRevision } from '../assembly-procedure-document-revision.serializer.js';
import { serializeProcedureDocument } from '../../../routes/assembly/procedure-documents.js';
import { ProcedureMaterialPlacementService } from '../procedure-material-placement.service.js';

const documentId = 'document';
const path = '/api/storage/assembly-procedure-images/blank.png';
const locked = { id: documentId, status: 'DRAFT', isActive: true, revisionRootId: documentId, isRevisionHead: true, editVersion: 3 };
const access = { requireAccessPassword: vi.fn().mockResolvedValue(undefined) };
const store = { read: vi.fn() };

beforeEach(async () => {
  vi.clearAllMocks();
  const db = mocks.db;
  db.$transaction.mockImplementation(async (work) => work(db));
  db.$queryRaw.mockResolvedValue([locked]);
  db.assemblyProcedureDocument.findFirst.mockResolvedValue(null);
  db.procedureManualProcess.findFirst.mockResolvedValue({ id: 'cutting' });
  db.procedureManualAssignment.findMany.mockResolvedValue([{ sortOrder: 4 }]);
  db.procedureManualAssignment.create.mockResolvedValue({ id: 'assigned' });
  db.assemblyProcedureDocument.create.mockResolvedValue({ id: documentId });
  db.assemblyProcedureDocument.findUnique.mockResolvedValue({ ...locked, pages: [{ pageIndex: 0, imageRelativePath: path }], revisionMetadata: { ...locked } });
  db.assemblyProcedureDocumentPage.aggregate.mockResolvedValue({ _max: { pageIndex: 5 } });
  db.assemblyProcedureDocumentPage.findUnique.mockResolvedValue({ imageRelativePath: path });
  db.assemblyProcedureOverlayElement.aggregate.mockResolvedValue({ _max: { zIndex: 7 } });
  db.procedureMaterial.findUnique.mockResolvedValue({ id: 'material', kind: 'TEXT', text: '本文', documentId: null, placedAt: null, discardedAt: null });
  db.procedureMaterial.updateMany.mockResolvedValue({ count: 1 });
  mocks.saveImage.mockResolvedValue({ relativeUrl: path, contentType: 'image/png' });
  const png = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }).png().toBuffer();
  store.read.mockResolvedValue(png);
  mocks.readImage.mockResolvedValue({ buffer: await sharp({ create: { width: 1240, height: 1754, channels: 3, background: '#ffffff' } }).png().toBuffer() });
  mocks.assetSave.mockResolvedValue({ assetId: 'asset', storageKey: 'assembly-procedure-assets/asset.png', relativeUrl: '/api/storage/assembly-procedure-assets/asset.png', sha256: 'a'.repeat(64), size: png.length, contentType: 'image/png' });
});

describe('procedure-document blank pages', () => {
  it('creates a white A4 PNG, one DRAFT page and the revision sidecar without a mandatory SOURCE', async () => {
    await new AssemblyProcedureDocumentBlankService().create('白紙');
    const bytes = mocks.saveImage.mock.calls[0]![0];
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1240, height: 1754, format: 'png' });
    expect(await sharp(bytes).stats()).toMatchObject({ channels: expect.arrayContaining([expect.objectContaining({ min: 255, max: 255 })]) });
    expect(mocks.db.assemblyProcedureDocument.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '白紙', status: 'DRAFT', imageRelativePath: path, pages: { create: [{ pageIndex: 0, imageRelativePath: path }] } }) });
    expect(mocks.db.assemblyProcedureDocumentRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ editVersion: 0, sourceAssetId: null }) });
    expect(mocks.db.assemblyProcedureAsset.create).not.toHaveBeenCalled();
  });
  it('chooses -2 then -3 on the server under the naming transaction lock', async () => {
    mocks.db.assemblyProcedureDocument.findFirst.mockResolvedValueOnce({ id: 'one' }).mockResolvedValueOnce({ id: 'two' }).mockResolvedValueOnce(null);
    await new AssemblyProcedureDocumentBlankService().create('DFD1_組立_組立');
    expect(mocks.db.$executeRaw.mock.calls[0]![0].join('')).toContain('pg_advisory_xact_lock');
    expect(mocks.db.assemblyProcedureDocument.findFirst.mock.calls.map(call => call[0].where.name)).toEqual(['DFD1_組立_組立', 'DFD1_組立_組立-2', 'DFD1_組立_組立-3']);
    expect(mocks.db.assemblyProcedureDocument.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'DFD1_組立_組立-3' }) });
  });
  it('creates and appends a DRAFT with the normalized model after existing assignments', async () => {
    const result = await new AssemblyProcedureDocumentBlankService().createWithAssignment('新規', { modelCode: 'ｄｆｄ１', processId: 'cutting' });
    expect(result.assignmentError).toBeNull();
    expect(result.document.id).toBe(documentId);
    expect(mocks.db.procedureManualAssignment.create).toHaveBeenCalledWith({ data: { modelCode: 'DFD1', modelCodeKey: 'DFD1', processId: 'cutting', assemblyProcedureDocumentId: documentId, sortOrder: 5 } });
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
  });
  it('keeps the created document/image and returns a short error if assignment fails', async () => {
    mocks.db.procedureManualProcess.findFirst.mockResolvedValueOnce(null);
    const result = await new AssemblyProcedureDocumentBlankService().createWithAssignment('新規', { modelCode: 'DFD1', processId: 'missing' });
    expect(result.document.id).toBe(documentId);
    expect(result.assignmentError).toContain('割り当てに失敗');
    expect(mocks.db.assemblyProcedureDocument.create).toHaveBeenCalledOnce();
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.db.procedureManualAssignment.create).not.toHaveBeenCalled();
  });
  it('appends at max+1 without updating the compatibility path or existing page numbers', async () => {
    await new AssemblyProcedureDocumentRevisionService(access as never).addBlankPage({ documentId, expectedEditVersion: 3 });
    expect(mocks.db.assemblyProcedureDocumentPage.create).toHaveBeenCalledWith({ data: { documentId, pageIndex: 6, imageRelativePath: path } });
    expect(mocks.db.assemblyProcedureDocumentRevision.update).toHaveBeenCalledWith({ where: { documentId }, data: { editVersion: { increment: 1 } } });
    expect(mocks.db.assemblyProcedureDocument.create).not.toHaveBeenCalled();
  });
  it('rejects published documents and stale editVersion before saving a page', async () => {
    const service = new AssemblyProcedureDocumentRevisionService(access as never);
    mocks.db.$queryRaw.mockResolvedValueOnce([{ ...locked, status: 'PUBLISHED' }]);
    await expect(service.addBlankPage({ documentId, expectedEditVersion: 3 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.addBlankPage({ documentId, expectedEditVersion: 2 })).rejects.toMatchObject({ statusCode: 409, code: 'ASSEMBLY_PROCEDURE_EDIT_CONFLICT', details: { currentEditVersion: 3 } });
    expect(mocks.saveImage).not.toHaveBeenCalled();
  });
  it('removes the new image if the page transaction fails', async () => {
    mocks.db.assemblyProcedureDocumentPage.create.mockRejectedValueOnce(new Error('DB failed'));
    await expect(new AssemblyProcedureDocumentRevisionService(access as never).addBlankPage({ documentId, expectedEditVersion: 3 })).rejects.toThrow('DB failed');
    expect(mocks.deleteImage).toHaveBeenCalledWith(path);
  });
});

describe('procedure-material placement', () => {
  const service = () => new ProcedureMaterialPlacementService(store as never, new AssemblyProcedureDocumentAssetsService({ accessService: access as never, textCandidates: {} as never }), access as never);
  it('returns a TEXT draft element and conditionally marks placement without persisting an overlay', async () => {
    const result = await service().place({ documentId, materialId: 'material', pageIndex: 0 });
    expect(result.element).toMatchObject({ kind: 'TEXT', text: '本文', pageIndex: 0, zIndex: 8, bbox: { xRatio: 0.1, widthRatio: 0.8 }, style: { fontWeight: 'bold' } });
    expect(mocks.db.procedureMaterial.updateMany).toHaveBeenCalledWith({ where: { id: 'material', discardedAt: null }, data: { documentId, placedAt: expect.any(Date) } });
    expect(mocks.db.assemblyProcedureOverlayElement.createMany).not.toHaveBeenCalled();
  });
  it('uploads PHOTO through the existing IMAGE asset service with ownership and aspect-preserving placement', async () => {
    mocks.db.procedureMaterial.findUnique.mockResolvedValue({ id: 'material', kind: 'PHOTO', storageKey: 'procedure-materials/hash/original', contentType: 'image/png', originalFileName: 'photo.png' });
    const result = await service().place({ documentId, materialId: 'material', pageIndex: 0 });
    expect(result).toMatchObject({ asset: { assetId: 'asset' }, element: { kind: 'IMAGE', assetId: 'asset', bbox: { widthRatio: 0.4, xRatio: 0.3 } } });
    expect(result.element.bbox.heightRatio).toBeCloseTo(0.4 * 0.5 * 1240 / 1754);
    expect(mocks.db.assemblyProcedureAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'OVERLAY_IMAGE', ownerDocumentId: documentId }) });
    expect(store.read).toHaveBeenCalledWith('procedure-materials/hash/original', { verifyIntegrity: true });
  });
  it('loads the leased PHOTO asset with its display URL before saving the placed overlay', async () => {
    mocks.db.procedureMaterial.findUnique.mockResolvedValue({ id: 'material', kind: 'PHOTO', storageKey: 'original', contentType: 'image/png' });
    const placed = await service().place({ documentId, materialId: 'material', pageIndex: 0 });
    const asset = mocks.db.assemblyProcedureAsset.create.mock.calls[0]![0].data;
    expect(asset.ownerDocumentId).toBe(documentId);
    mocks.db.assemblyProcedureDocument.findUnique.mockImplementation(async ({ include }) => ({
      ...locked, name: '白紙', imageRelativePath: path, publishedAt: null, createdAt: new Date(), updatedAt: new Date(),
      pages: [{ pageIndex: 0, imageRelativePath: path }], overlayElements: [], revisionMetadata: { ...locked },
      ownedAssets: include.ownedAssets ? [asset] : []
    }));
    mocks.db.assemblyProcedureDocument.findFirst.mockImplementation(async (args) => mocks.db.assemblyProcedureDocument.findUnique(args));
    const document = await new AssemblyProcedureDocumentService().getById(documentId, { includeInactive: true });
    const revision = await new AssemblyProcedureDocumentRevisionService(access as never).getById(documentId);
    const assetId = placed.element.kind === 'IMAGE' ? placed.element.assetId : '';
    expect(serializeProcedureDocument(document!).assets[assetId]?.url).toBe(placed.asset?.relativeUrl);
    expect(serializeAssemblyProcedureDocumentRevision(revision!).assets[assetId]?.url).toBe(placed.asset?.relativeUrl);
    expect(mocks.db.assemblyProcedureOverlayElement.createMany).not.toHaveBeenCalled();
  });
  it('reuses a placed PHOTO in another document with a new asset and latest placement metadata each time', async () => {
    const previousPlacedAt = new Date('2026-10-05T04:00:00Z');
    const material = { id: 'material', kind: 'PHOTO', storageKey: 'original', contentType: 'image/png', documentId: 'previous-document', placedAt: previousPlacedAt, discardedAt: null };
    mocks.db.procedureMaterial.findUnique.mockImplementation(async () => ({ ...material }));
    mocks.db.procedureMaterial.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(material, data);
      return { count: 1 };
    });
    const savedAsset = { sha256: 'a'.repeat(64), size: 100, contentType: 'image/png' };
    mocks.assetSave.mockResolvedValueOnce({ ...savedAsset, assetId: 'first-copy', storageKey: 'assets/first.png', relativeUrl: '/assets/first.png' }).mockResolvedValueOnce({ ...savedAsset, assetId: 'second-copy', storageKey: 'assets/second.png', relativeUrl: '/assets/second.png' });
    const first = await service().place({ documentId, materialId: material.id, pageIndex: 0 });
    expect(material.documentId).toBe(documentId);
    expect(material.placedAt.getTime()).toBeGreaterThan(previousPlacedAt.getTime());
    mocks.db.$queryRaw.mockResolvedValue([{ ...locked, id: 'another-document' }]);
    const beforeSecond = Date.now();
    const second = await service().place({ documentId: 'another-document', materialId: material.id, pageIndex: 0 });
    expect(first.element).toMatchObject({ kind: 'IMAGE', assetId: 'first-copy' });
    expect(second.element).toMatchObject({ kind: 'IMAGE', assetId: 'second-copy' });
    expect(second.element.id).not.toBe(first.element.id);
    expect(mocks.assetSave).toHaveBeenCalledTimes(2);
    expect(store.read).toHaveBeenCalledTimes(2);
    expect(mocks.db.assemblyProcedureAsset.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ id: 'second-copy', ownerDocumentId: 'another-document' }) });
    expect(mocks.db.procedureMaterial.updateMany).toHaveBeenLastCalledWith({ where: { id: material.id, discardedAt: null }, data: { documentId: 'another-document', placedAt: expect.any(Date) } });
    expect(material).toMatchObject({ documentId: 'another-document', placedAt: expect.any(Date), discardedAt: null });
    expect(material.placedAt.getTime()).toBeGreaterThanOrEqual(beforeSecond);
  });
  it.each([{ discardedAt: new Date() }, { documentId, placedAt: new Date(), discardedAt: new Date() }])('rejects discarded materials %j', async (state) => {
    mocks.db.procedureMaterial.findUnique.mockResolvedValue({ kind: 'TEXT', text: '本文', ...state });
    await expect(service().place({ documentId, materialId: 'material', pageIndex: 0 })).rejects.toMatchObject({ statusCode: 409, message: '捨てた素材は配置できません' });
    expect(mocks.db.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(mocks.assetSave).not.toHaveBeenCalled();
  });
  it('rejects PUBLISHED and invalid pages without consuming material', async () => {
    mocks.db.$queryRaw.mockResolvedValueOnce([{ ...locked, status: 'PUBLISHED' }]);
    await expect(service().place({ documentId, materialId: 'material', pageIndex: 0 })).rejects.toMatchObject({ statusCode: 409 });
    mocks.db.assemblyProcedureDocumentPage.findUnique.mockResolvedValueOnce(null);
    await expect(service().place({ documentId, materialId: 'material', pageIndex: 99 })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.db.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });
  it('rejects conditional-update conflicts and removes an unreturned PHOTO asset', async () => {
    mocks.db.procedureMaterial.findUnique.mockResolvedValue({ id: 'material', kind: 'PHOTO', storageKey: 'original', contentType: 'image/png' });
    mocks.db.procedureMaterial.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service().place({ documentId, materialId: 'material', pageIndex: 0 })).rejects.toMatchObject({ statusCode: 409, message: '捨てた素材は配置できません' });
    expect(mocks.assetDelete).toHaveBeenCalledWith({ storageKey: 'assembly-procedure-assets/asset.png' });
  });
  it('rejects oversized TEXT before placement state changes', async () => {
    mocks.db.procedureMaterial.findUnique.mockResolvedValue({ kind: 'TEXT', text: 'x'.repeat(10001) });
    await expect(service().place({ documentId, materialId: 'material', pageIndex: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.db.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });
});
