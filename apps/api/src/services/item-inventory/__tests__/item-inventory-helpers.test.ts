import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { normalizeInventoryArea, normalizeInventoryUnit } from '../inventory-area.js';
import {
  assertNfcUidAvailable,
  locationDto,
  newItemCode,
  nonNegativeInteger,
  positiveInteger,
  resolveUnit,
  runSerializable,
} from '../item-inventory.helpers.js';
import { InventoryConflictError, InventoryInsufficientStockError } from '../item-inventory.errors.js';

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('prisma error', { code, clientVersion: '5.22.0' });
}

function uidDb(found: Partial<Record<'employee' | 'item' | 'measuring' | 'rigging' | 'machine', boolean>> = {}) {
  const hit = (key: keyof typeof found) => vi.fn().mockResolvedValue(found[key] ? { id: `${key}-1` } : null);
  return {
    employee: { findFirst: hit('employee') },
    item: { findFirst: hit('item') },
    measuringInstrumentTag: { findFirst: hit('measuring') },
    riggingGearTag: { findFirst: hit('rigging') },
    machineNfcTag: { findUnique: hit('machine') },
  };
}

describe('item inventory quantity validation', () => {
  it('positiveInteger accepts 1 and the max safe integer and returns the value unchanged', () => {
    expect(positiveInteger(1, '数量')).toBe(1);
    expect(positiveInteger(Number.MAX_SAFE_INTEGER, '数量')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'positiveInteger rejects %s with a 400 naming the label',
    (value) => {
      expect(() => positiveInteger(value, '数量')).toThrow(
        expect.objectContaining({ statusCode: 400, message: '数量は1以上の整数で指定してください' }),
      );
    },
  );

  it('nonNegativeInteger accepts 0 but rejects negatives and fractions', () => {
    expect(nonNegativeInteger(0, '初期数量')).toBe(0);
    expect(nonNegativeInteger(7, '初期数量')).toBe(7);
    expect(() => nonNegativeInteger(-1, '初期数量')).toThrow(
      expect.objectContaining({ statusCode: 400, message: '初期数量は0以上の整数で指定してください' }),
    );
    expect(() => nonNegativeInteger(0.5, '在庫数')).toThrow(
      expect.objectContaining({ statusCode: 400, message: '在庫数は0以上の整数で指定してください' }),
    );
  });
});

describe('item inventory domain errors', () => {
  it('maps insufficient stock and conflicts to 409 with stable codes', () => {
    const shortage = new InventoryInsufficientStockError();
    expect(shortage).toMatchObject({ statusCode: 409, code: 'INVENTORY_INSUFFICIENT_STOCK', message: '在庫が不足しています' });
    expect(new InventoryConflictError()).toMatchObject({
      statusCode: 409,
      code: 'INVENTORY_CONFLICT',
      message: '在庫が更新されています。画面を再読み込みしてください',
    });
    expect(new InventoryConflictError('custom').message).toBe('custom');
  });
});

describe('newItemCode', () => {
  it('embeds the source id and an 8-character uppercase hex suffix', () => {
    const code = newItemCode(42);
    expect(code).toMatch(/^RI-42-[0-9A-F]{8}$/);
    expect(newItemCode(42)).not.toBe(code);
  });
});

describe('locationDto', () => {
  it('flattens shelf/drawer location and fills optional item fields with null', () => {
    const dto = locationDto({
      id: 'c1',
      labelNumber: 12,
      stockQuantity: 3,
      drawer: { drawerNumber: 4, shelf: { area: 'A-1', shelfNumber: 2 } },
      itemTag: null,
      inventoryItem: { id: 'i1', itemCode: 'RI-1', name: 'ドリル', model: null, usage: null, category: null, area: null, note: null },
    });
    expect(dto).toEqual({
      id: 'c1',
      labelNumber: 12,
      stockQuantity: 3,
      reorderPoint: null,
      reorderedAt: null,
      area: 'A-1',
      shelfNumber: 2,
      drawerNumber: 4,
      itemTagUid: null,
      item: {
        id: 'i1', itemCode: 'RI-1', name: 'ドリル', model: null, usage: null, category: null, area: null, note: null,
        unit: null, unitPrice: null, maker: null, toolName: null, workMaterial: null, toolSize: null, photos: [],
      },
    });
  });

  it('keeps a unit price of 0 rather than turning it into null', () => {
    const dto = locationDto({
      id: 'c1', labelNumber: 1, stockQuantity: 0,
      drawer: { drawerNumber: 1, shelf: { area: 'A', shelfNumber: 1 } },
      itemTag: { uid: 'UID-1' },
      inventoryItem: { id: 'i1', itemCode: 'x', name: 'n', model: null, usage: null, category: null, area: null, note: null, unitPrice: 0, unit: 'ケース' },
    });
    expect(dto.item.unitPrice).toBe(0);
    expect(dto.item.unit).toBe('ケース');
    expect(dto.itemTagUid).toBe('UID-1');
  });
});

describe('assertNfcUidAvailable', () => {
  it('passes when no other NFC domain owns the uid and queries every domain with that uid', async () => {
    const db = uidDb();
    await expect(assertNfcUidAvailable('04AABB', db as never)).resolves.toBeUndefined();
    expect(db.employee.findFirst).toHaveBeenCalledWith({ where: { nfcTagUid: '04AABB' }, select: { id: true } });
    expect(db.measuringInstrumentTag.findFirst).toHaveBeenCalledWith({ where: { rfidTagUid: '04AABB' }, select: { id: true } });
    expect(db.machineNfcTag.findUnique).toHaveBeenCalledWith({ where: { uid: '04AABB' }, select: { id: true } });
  });

  it.each(['employee', 'item', 'measuring', 'rigging'] as const)('rejects a uid used by %s with 409', async (owner) => {
    await expect(assertNfcUidAvailable('U', uidDb({ [owner]: true }) as never)).rejects.toMatchObject({
      statusCode: 409,
      message: 'このUIDは既存の社員・工具・計測機器・玉掛け具で使用中です',
    });
  });

  it('reports the machine message first when a machine and an employee both own the uid', async () => {
    await expect(assertNfcUidAvailable('U', uidDb({ machine: true, employee: true }) as never)).rejects.toMatchObject({
      statusCode: 409,
      message: 'このUIDは既存の加工機で使用中です',
    });
  });
});

describe('runSerializable', () => {
  it('runs the work in a serializable transaction', async () => {
    const db = { $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work('tx')) };
    await expect(runSerializable(db as never, async (tx) => `done:${String(tx)}`)).resolves.toBe('done:tx');
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });

  it('retries serialization failures (P2034) and succeeds on the third attempt', async () => {
    const db = {
      $transaction: vi.fn()
        .mockRejectedValueOnce(knownError('P2034'))
        .mockRejectedValueOnce(knownError('P2034'))
        .mockResolvedValueOnce('ok'),
    };
    await expect(runSerializable(db as never, async () => 'unused')).resolves.toBe('ok');
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after three P2034 failures and rethrows the last error', async () => {
    const last = knownError('P2034');
    const db = {
      $transaction: vi.fn()
        .mockRejectedValueOnce(knownError('P2034'))
        .mockRejectedValueOnce(knownError('P2034'))
        .mockRejectedValueOnce(last),
    };
    await expect(runSerializable(db as never, async () => 'unused')).rejects.toBe(last);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry other Prisma errors or domain errors', async () => {
    const unique = knownError('P2002');
    const db = { $transaction: vi.fn().mockRejectedValue(unique) };
    await expect(runSerializable(db as never, async () => 'unused')).rejects.toBe(unique);
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    const shortage = new InventoryInsufficientStockError();
    const db2 = { $transaction: vi.fn().mockRejectedValue(shortage) };
    await expect(runSerializable(db2 as never, async () => 'unused')).rejects.toBe(shortage);
    expect(db2.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('resolveUnit', () => {
  it('returns null for null or a blank unit without querying', async () => {
    const db = { inventoryUnit: { findUnique: vi.fn() } };
    await expect(resolveUnit(db as never, null)).resolves.toBeNull();
    await expect(resolveUnit(db as never, '　 ')).resolves.toBeNull();
    expect(db.inventoryUnit.findUnique).not.toHaveBeenCalled();
  });

  it('normalizes full-width spelling before looking up the registered unit', async () => {
    const db = { inventoryUnit: { findUnique: vi.fn().mockResolvedValue({ name: 'ケース' }) } };
    await expect(resolveUnit(db as never, ' ｹｰｽ ')).resolves.toBe('ケース');
    expect(db.inventoryUnit.findUnique).toHaveBeenCalledWith({ where: { name: 'ケース' } });
  });

  it('rejects an unregistered unit with 400', async () => {
    const db = { inventoryUnit: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(resolveUnit(db as never, '箱')).rejects.toMatchObject({ statusCode: 400, message: '単位「箱」は登録されていません' });
  });
});

describe('normalizeInventoryArea', () => {
  it('applies NFKC, trims and collapses inner whitespace', () => {
    expect(normalizeInventoryArea('　30041R_2ＭＦ-Ｐ　')).toBe('30041R_2MF-P');
    expect(normalizeInventoryArea('A  \t 棚')).toBe('A 棚');
    expect(normalizeInventoryUnit).toBe(normalizeInventoryArea);
  });
});
