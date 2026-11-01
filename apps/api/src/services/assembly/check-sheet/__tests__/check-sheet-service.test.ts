import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyCheckSheetService } from '../check-sheet.service.js';
import { normalizeCheckSheet } from '../check-sheet-normalizer.js';
import { parseCheckSheetXlsx } from '../check-sheet-xlsx-parser.js';
import { makeCheckSheetWorkbook } from './check-sheet.fixture.js';
import { FileStorageAlreadyExistsError } from '../../../file-storage/file-storage-errors.js';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    assemblyCheckSheetRevision: {
      create: vi.fn(), updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findUniqueOrThrow: vi.fn()
    },
    assemblyCheckSheetGroup: { createMany: vi.fn() }, assemblyCheckSheetItem: { createMany: vi.fn() }
  };
  return {
    tx,
    db: {
      assemblyCheckSheetAsset: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
      assemblyCheckSheetRevision: { findUnique: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    },
    store: { initialize: vi.fn(), write: vi.fn(), read: vi.fn() }
  };
});
vi.mock('../../../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: mocks.store }) }));

const assetId = '00000000-0000-4000-8000-000000000001';
const rootId = '00000000-0000-4000-8000-000000000002';
const service = new AssemblyCheckSheetService();

describe('check-sheet import and revision persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.assemblyCheckSheetAsset.findUnique.mockResolvedValue({ id: assetId, storageKey: 'original.xlsx' });
    mocks.db.assemblyCheckSheetAsset.upsert.mockResolvedValue({ id: assetId });
    mocks.store.write.mockResolvedValue(undefined);
    mocks.tx.$queryRaw.mockResolvedValue([{ id: rootId }]);
    mocks.tx.assemblyCheckSheetRevision.findFirstOrThrow.mockResolvedValue({ revisionNumber: 3 });
    mocks.tx.assemblyCheckSheetRevision.findUniqueOrThrow.mockImplementation(async () => ({
      ...mocks.tx.assemblyCheckSheetRevision.create.mock.calls[0][0].data,
      isRevisionHead: true, createdAt: new Date('2026-10-29T00:00:00Z'),
      groups: mocks.tx.assemblyCheckSheetGroup.createMany.mock.calls[0][0].data,
      items: mocks.tx.assemblyCheckSheetItem.createMany.mock.calls[0][0].data.map((item: object, index: number) => ({ ...item, id: `item-${index}` }))
    }));
  });

  it('keeps original bytes and deduplicates repeated uploads by SHA-256', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const first = await service.importWorkbook(buffer, 'synthetic.xlsx');
    expect(first.proposal.items).toHaveLength(9);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    expect(mocks.store.write).toHaveBeenCalledWith({
      key: `assembly-check-sheet-sources/${sha256}.xlsx`, data: buffer, mode: 'create', integrity: true
    });
    mocks.store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError());
    mocks.store.read.mockResolvedValueOnce(buffer);
    const second = await service.importWorkbook(buffer, 'again.xlsx');
    expect(second.importId).toBe(first.importId);
    expect(mocks.db.assemblyCheckSheetAsset.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ where: { sha256 }, update: {} }));
  });

  it('records Gmail provenance on the same SHA asset and shows a re-sent dismissed file again', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const gmail = { gmailMessageId: 'mail-1', receivedAt: new Date('2026-10-29T01:00:00Z') };
    await service.importWorkbook(buffer, 'mail.xlsx', undefined, gmail);
    expect(mocks.db.assemblyCheckSheetAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sha256: createHash('sha256').update(buffer).digest('hex') },
      update: { ...gmail, originalFileName: 'mail.xlsx', dismissedAt: null },
      create: expect.objectContaining({ ...gmail, originalFileName: 'mail.xlsx' })
    }));
  });

  it('lists only pending Gmail sources newest first and serializes received dates', async () => {
    mocks.db.assemblyCheckSheetAsset.findMany.mockResolvedValue([{ id: assetId, originalFileName: 'mail.xlsx', receivedAt: new Date('2026-10-29T01:00:00Z') }]);
    expect(await service.listGmailImports()).toEqual({ items: [{ importId: assetId, originalFileName: 'mail.xlsx', receivedAt: '2026-10-29T01:00:00.000Z' }] });
    expect(mocks.db.assemblyCheckSheetAsset.findMany).toHaveBeenCalledWith({
      where: { gmailMessageId: { not: null }, revisions: { none: {} }, dismissedAt: null },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }], select: { id: true, originalFileName: true, receivedAt: true }
    });
  });

  it('reparses stored Gmail bytes with the shared proposal parser and sheet selection', async () => {
    const buffer = await makeCheckSheetWorkbook();
    mocks.db.assemblyCheckSheetAsset.findFirst.mockResolvedValue({ id: assetId, storageKey: 'original.xlsx' });
    mocks.store.read.mockResolvedValue(buffer);
    const original = await service.importWorkbook(buffer, 'mail.xlsx');
    mocks.store.write.mockClear();
    expect(await service.getGmailImport(assetId, original.proposal.sourceSheetName)).toEqual(original);
    expect(mocks.store.read).toHaveBeenCalledWith('original.xlsx', { verifyIntegrity: true });
    expect(mocks.store.write).not.toHaveBeenCalled();
    await expect(service.getGmailImport(assetId, '不存在')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.db.assemblyCheckSheetAsset.findFirst).toHaveBeenCalledWith({
      where: { id: assetId, gmailMessageId: { not: null }, revisions: { none: {} }, dismissedAt: null }
    });
  });

  it('dismisses only pending Gmail imports and rejects unavailable imports', async () => {
    mocks.db.assemblyCheckSheetAsset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await service.dismissGmailImport(assetId)).toEqual({ importId: assetId });
    expect(mocks.db.assemblyCheckSheetAsset.updateMany).toHaveBeenCalledWith({
      where: { id: assetId, gmailMessageId: { not: null }, revisions: { none: {} }, dismissedAt: null }, data: { dismissedAt: expect.any(Date) }
    });
    await expect(service.dismissGmailImport(assetId)).rejects.toMatchObject({ statusCode: 404 });
    mocks.db.assemblyCheckSheetAsset.findFirst.mockResolvedValueOnce(null);
    await expect(service.getGmailImport(assetId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects invalid sources before storage and database writes', async () => {
    await expect(service.importWorkbook(Buffer.from('bad'), 'bad.xlsx')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.store.write).not.toHaveBeenCalled();
    expect(mocks.db.assemblyCheckSheetAsset.upsert).not.toHaveBeenCalled();
  });

  it('does not accept an existing storage object with different bytes', async () => {
    mocks.store.write.mockRejectedValueOnce(new FileStorageAlreadyExistsError());
    mocks.store.read.mockResolvedValueOnce(Buffer.from('different'));
    await expect(service.importWorkbook(await makeCheckSheetWorkbook(), 'synthetic.xlsx')).rejects.toBeInstanceOf(FileStorageAlreadyExistsError);
    expect(mocks.db.assemblyCheckSheetAsset.upsert).not.toHaveBeenCalled();
  });

  it('creates a root revision with edited items, groups and exact original asset', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(buffer));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    proposal.items[0].inputSpec.fields![0].unit = 'N·m (edited)';
    mocks.store.read.mockResolvedValue(buffer);
    const saved = await service.saveRevision({ importId: assetId, proposal }, 'admin-id');
    expect(saved.id).toBe(saved.revisionRootId);
    expect(saved).toMatchObject({ revisionNumber: 1, sourceAssetId: assetId, createdByUserId: 'admin-id', layoutSnapshot: expect.objectContaining({ cells: expect.any(Object) }) });
    expect(saved.items[0].inputSpec.fields![0].unit).toBe('N·m (edited)');
    expect(saved.groups).toHaveLength(3);
    expect(mocks.db.$transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.assemblyCheckSheetRevision.updateMany).not.toHaveBeenCalled();
  });

  it('locks the stable root, advances the number and demotes the old head in one transaction', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(buffer));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    mocks.store.read.mockResolvedValue(buffer);
    const saved = await service.saveRevision({ importId: assetId, proposal, revisionRootId: rootId }, 'admin-id');
    expect(saved).toMatchObject({ revisionRootId: rootId, revisionNumber: 4 });
    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.assemblyCheckSheetRevision.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.tx.assemblyCheckSheetRevision.updateMany).toHaveBeenCalledWith({ where: { revisionRootId: rootId, isRevisionHead: true }, data: { isRevisionHead: false } });
    expect(mocks.db.$transaction).toHaveBeenCalledOnce();
  });

  it('rejects missing imports, unknown roots and sheet names before revision writes', async () => {
    const buffer = await makeCheckSheetWorkbook();
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(buffer));
    proposal.departmentRoleMembers = { 制御設計担当: ['00000000-0000-4000-8000-000000000003'] };
    mocks.db.assemblyCheckSheetAsset.findUnique.mockResolvedValueOnce(null);
    await expect(service.saveRevision({ importId: assetId, proposal }, 'admin')).rejects.toMatchObject({ statusCode: 404 });
    mocks.store.read.mockResolvedValue(buffer);
    mocks.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.saveRevision({ importId: assetId, proposal, revisionRootId: rootId }, 'admin')).rejects.toMatchObject({ statusCode: 404 });
    proposal.sourceSheetName = '不存在';
    await expect(service.saveRevision({ importId: assetId, proposal }, 'admin')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.tx.assemblyCheckSheetRevision.create).not.toHaveBeenCalled();
    expect(mocks.tx.assemblyCheckSheetRevision.updateMany).not.toHaveBeenCalled();
  });

  it('rejects empty department roles even when saveRevision is called directly', async () => {
    const proposal = normalizeCheckSheet(await parseCheckSheetXlsx(await makeCheckSheetWorkbook()));
    await expect(service.saveRevision({ importId: assetId, proposal }, 'admin')).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ['proposal', 'departmentRoleMembers', '制御設計担当'], message: expect.stringContaining('制御設計担当') })]
    });
    expect(mocks.db.assemblyCheckSheetAsset.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it('selects heads by default and lineage history only when requested', async () => {
    mocks.db.assemblyCheckSheetRevision.findMany.mockResolvedValue([]);
    await service.listRevisions();
    expect(mocks.db.assemblyCheckSheetRevision.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { isRevisionHead: true } }));
    await service.listRevisions(rootId);
    expect(mocks.db.assemblyCheckSheetRevision.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { revisionRootId: rootId } }));
    mocks.db.assemblyCheckSheetRevision.findUnique.mockResolvedValue(null);
    await expect(service.getRevision(rootId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
