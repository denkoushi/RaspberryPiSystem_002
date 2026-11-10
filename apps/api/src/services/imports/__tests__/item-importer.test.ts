import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import type { CsvImportConfigService } from '../csv-import-config.service.js';
import { ItemCsvImporter } from '../importers/item.js';

const mocks = vi.hoisted(() => ({
  item: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  loan: { findMany: vi.fn() },
  machineNfcTag: { findUnique: vi.fn() },
  inventoryNfcTag: { findFirst: vi.fn() },
  transactionOptions: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => {
  const tx = { item: mocks.item, machineNfcTag: mocks.machineNfcTag, inventoryNfcTag: mocks.inventoryNfcTag };
  return {
    prisma: {
      item: mocks.item,
      loan: mocks.loan,
      $transaction: async (run: (client: unknown) => unknown, options: unknown) => {
        mocks.transactionOptions(options);
        return run(tx);
      },
    },
  };
});

const config = { getEffectiveConfig: vi.fn() };
const importer = () => new ItemCsvImporter(config as unknown as CsvImportConfigService);
const csv = (text: string) => Buffer.from(text, 'utf-8');

const existingItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  itemCode: 'TO0001',
  name: 'スパナ',
  description: null,
  category: null,
  storageLocation: null,
  nfcTagUid: null,
  status: 'AVAILABLE',
  notes: null,
  ...overrides,
});

describe('ItemCsvImporter.parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.getEffectiveConfig.mockResolvedValue(null);
  });

  it('returns no rows for an empty buffer', async () => {
    await expect(importer().parse(Buffer.alloc(0))).resolves.toEqual([]);
  });

  it('strips UTF-8 BOM and trims cells in the fixed-schema path', async () => {
    const rows = await importer().parse(csv('﻿itemCode,name,category\n TO0001 , スパナ ,  工具 \n'));
    expect(rows).toEqual([{ itemCode: 'TO0001', name: 'スパナ', category: '工具' }]);
  });

  it.each(['TO001', 'TO00001', 'to0001', 'TO０００１', 'AB0001'])('rejects itemCode %s with a row-numbered 400', async code => {
    const error = await importer()
      .parse(csv(`itemCode,name\nTO0001,OK\n${code},スパナ\n`))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
    // header is line 1, first data row line 2, so the failing row is line 3
    expect((error as ApiError).message).toContain('アイテムCSVの3行目でエラー');
    expect((error as ApiError).message).toContain('管理番号はTO + 数字4桁である必要があります');
  });

  it('rejects a blank name', async () => {
    const error = await importer().parse(csv('itemCode,name\nTO0001,\n')).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('アイテムCSVの2行目でエラー');
    expect((error as ApiError).message).toContain('工具名は必須です');
  });

  it('uses configured column definitions (Japanese headers) when present', async () => {
    config.getEffectiveConfig.mockResolvedValue({
      columnDefinitions: [
        { internalName: 'itemCode', displayName: '管理番号', csvHeaderCandidates: ['管理番号'], dataType: 'string', order: 0 },
        { internalName: 'name', displayName: '工具名', csvHeaderCandidates: ['工具名'], dataType: 'string', order: 1 },
        { internalName: 'notes', displayName: '備考', csvHeaderCandidates: ['備考'], dataType: 'string', order: 2, required: false },
      ],
    });
    const rows = await importer().parse(csv('工具名,管理番号\nレンチ,TO0123\n'));
    expect(config.getEffectiveConfig).toHaveBeenCalledWith('items');
    expect(rows).toEqual([{ itemCode: 'TO0123', name: 'レンチ' }]);
  });

  it('reports validation failures from the mapped path with the same row numbering', async () => {
    config.getEffectiveConfig.mockResolvedValue({
      columnDefinitions: [
        { internalName: 'itemCode', displayName: '管理番号', csvHeaderCandidates: ['管理番号'], dataType: 'string', order: 0 },
        { internalName: 'name', displayName: '工具名', csvHeaderCandidates: ['工具名'], dataType: 'string', order: 1 },
      ],
    });
    const error = await importer().parse(csv('管理番号,工具名\nTO0001,A\nX1,B\n')).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('アイテムCSVの3行目でエラー');
  });
});

describe('ItemCsvImporter.import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.getEffectiveConfig.mockResolvedValue(null);
    mocks.machineNfcTag.findUnique.mockResolvedValue(null);
    mocks.inventoryNfcTag.findFirst.mockResolvedValue(null);
    mocks.item.findFirst.mockResolvedValue(null);
    mocks.loan.findMany.mockResolvedValue([]);
  });

  it('returns a zero summary without touching the DB for no rows', async () => {
    await expect(importer().import([], true)).resolves.toEqual({ processed: 0, created: 0, updated: 0 });
    expect(mocks.item.deleteMany).not.toHaveBeenCalled();
    expect(mocks.loan.findMany).not.toHaveBeenCalled();
  });

  it('creates new items with defaults and normalized status', async () => {
    mocks.item.findUnique.mockResolvedValue(null);
    const rows = await importer().parse(csv('itemCode,name,status,notes\nTO0001,スパナ,in_use,メモ\nTO0002,レンチ,,\n'));
    const summary = await importer().import(rows, false);

    expect(summary).toEqual({ processed: 2, created: 2, updated: 0 });
    expect(mocks.item.create).toHaveBeenNthCalledWith(1, {
      data: {
        itemCode: 'TO0001',
        name: 'スパナ',
        description: 'メモ',
        category: null,
        storageLocation: null,
        nfcTagUid: null,
        status: 'IN_USE',
        notes: 'メモ',
      },
    });
    expect(mocks.item.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ itemCode: 'TO0002', status: 'AVAILABLE', notes: null }) });
    expect(mocks.transactionOptions).toHaveBeenCalledWith({ timeout: 30000, isolationLevel: 'ReadCommitted' });
  });

  it('silently maps an unknown status to AVAILABLE', async () => {
    mocks.item.findUnique.mockResolvedValue(null);
    await importer().import([{ itemCode: 'TO0001', name: 'A', status: '貸出中' }], false);
    expect(mocks.item.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'AVAILABLE' }) });
  });

  it('updates only changed fields and does not count unchanged rows', async () => {
    mocks.item.findUnique
      .mockResolvedValueOnce(existingItem({ itemCode: 'TO0001', name: '旧名' }))
      .mockResolvedValueOnce(existingItem({ itemCode: 'TO0002', name: '同じ' }));
    const summary = await importer().import(
      [
        { itemCode: 'TO0001', name: '新名' },
        { itemCode: 'TO0002', name: '同じ' },
      ],
      false,
    );
    expect(summary).toEqual({ processed: 2, created: 0, updated: 1 });
    expect(mocks.item.update).toHaveBeenCalledTimes(1);
    expect(mocks.item.update).toHaveBeenCalledWith({ where: { itemCode: 'TO0001' }, data: { name: '新名' } });
  });

  it('rejects duplicate nfcTagUid inside the same CSV before any write', async () => {
    const error = await importer()
      .import(
        [
          { itemCode: 'TO0001', name: 'A', nfcTagUid: '04AABB' },
          { itemCode: 'TO0002', name: 'B', nfcTagUid: ' 04AABB ' },
        ],
        false,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toBe('CSV内でnfcTagUidが重複しています: nfcTagUid="04AABB" (itemCode: TO0001, TO0002)');
    expect(mocks.item.create).not.toHaveBeenCalled();
    expect(mocks.transactionOptions).not.toHaveBeenCalled();
  });

  it('rejects creating an item whose NFC UID is already used by another item', async () => {
    mocks.item.findUnique.mockResolvedValue(null);
    mocks.item.findFirst.mockResolvedValue(existingItem({ itemCode: 'TO0999', nfcTagUid: '04AA' }));
    const error = await importer().import([{ itemCode: 'TO0001', name: 'A', nfcTagUid: '04AA' }], false).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).message).toContain('itemCode="TO0999"');
    expect(mocks.item.findFirst).toHaveBeenCalledWith({ where: { nfcTagUid: '04AA' } });
    expect(mocks.item.create).not.toHaveBeenCalled();
  });

  it('excludes the updated item itself when checking NFC UID ownership', async () => {
    mocks.item.findUnique.mockResolvedValue(existingItem());
    await importer().import([{ itemCode: 'TO0001', name: 'スパナ', nfcTagUid: '04AA' }], false);
    expect(mocks.item.findFirst).toHaveBeenCalledWith({ where: { nfcTagUid: '04AA', itemCode: { not: 'TO0001' } } });
    expect(mocks.item.update).toHaveBeenCalledWith({ where: { itemCode: 'TO0001' }, data: { nfcTagUid: '04AA' } });
  });

  it('propagates 409 when the UID is bound to a machine NFC tag', async () => {
    mocks.item.findUnique.mockResolvedValue(null);
    mocks.machineNfcTag.findUnique.mockResolvedValue({ id: 'm1' });
    const error = await importer().import([{ itemCode: 'TO0001', name: 'A', nfcTagUid: '04AA' }], false).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(409);
    expect((error as ApiError).message).toBe('このUIDは加工機のNFCタグで使用中です');
    expect(mocks.item.create).not.toHaveBeenCalled();
  });

  it('propagates 409 when the UID is bound to an inventory NFC tag', async () => {
    mocks.item.findUnique.mockResolvedValue(null);
    mocks.inventoryNfcTag.findFirst.mockResolvedValue({ id: 'inv1' });
    const error = await importer().import([{ itemCode: 'TO0001', name: 'A', nfcTagUid: '04AA' }], false).catch((e: unknown) => e);
    expect((error as ApiError).statusCode).toBe(409);
    expect((error as ApiError).message).toBe('このUIDは在庫管理のNFCタグで使用中です');
  });

  it('replaceExisting keeps items referenced by loans', async () => {
    mocks.loan.findMany.mockResolvedValue([{ itemId: 'item-a' }, { itemId: null }, { itemId: 'item-b' }]);
    mocks.item.findUnique.mockResolvedValue(null);
    await importer().import([{ itemCode: 'TO0001', name: 'A' }], true);
    expect(mocks.item.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: ['item-a', 'item-b'] } } });
  });

  it('replaceExisting deletes every item when no loans reference items', async () => {
    mocks.loan.findMany.mockResolvedValue([{ itemId: null }]);
    mocks.item.findUnique.mockResolvedValue(null);
    await importer().import([{ itemCode: 'TO0001', name: 'A' }], true);
    expect(mocks.item.deleteMany).toHaveBeenCalledWith();
  });
});
