import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../item-inventory-machines.js', () => ({ assertMishimaMachine: vi.fn() }));

import { assertMishimaMachine } from '../item-inventory-machines.js';
import { InventoryConflictError, InventoryInsufficientStockError } from '../item-inventory.errors.js';
import {
  setReorderPoint,
  setOrdered,
  bindCompartment,
  cancelTransaction,
  correctStock,
  moveLocation,
  processTouchTransaction,
  processTransaction,
  replaceItemTag,
} from '../item-inventory-transactions.js';

type Tag = { id: string; uid: string; kind: 'ITEM' | 'QUANTITY' | 'RESTOCK'; compartmentId: string | null; quantity: number | null };

function makeDb(options: { stock?: number; reorderPoint?: number | null; reorderedAt?: Date | null; tags?: Tag[] } = {}) {
  const tags = new Map<string, Tag>((options.tags ?? [
    { id: 't-item', uid: 'item-uid', kind: 'ITEM', compartmentId: 'comp-1', quantity: null },
    { id: 't-qty', uid: 'qty-uid', kind: 'QUANTITY', compartmentId: null, quantity: 5 },
    { id: 't-restock', uid: 'restock-uid', kind: 'RESTOCK', compartmentId: null, quantity: null },
  ]).map((t) => [t.uid, t]));
  const state = { compartment: { id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: options.stock ?? 10, lastIssuedAt: null as Date | null, reorderPoint: options.reorderPoint ?? null, reorderedAt: options.reorderedAt ?? null } };
  const tx = {
    employee: { findFirst: vi.fn().mockResolvedValue(null) },
    item: { findFirst: vi.fn().mockResolvedValue(null) },
    measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
    riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
    machineNfcTag: { findUnique: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    inventoryNfcTag: {
      findUnique: vi.fn(async ({ where }: { where: { uid: string } }) => tags.get(where.uid) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Tag> }) => ({ ...[...tags.values()].find((t) => t.id === where.id), ...data })),
      create: vi.fn(async ({ data }: { data: Partial<Tag> }) => ({ id: 'new-tag', ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryItem: { findUnique: vi.fn() },
    inventoryDrawer: { findUnique: vi.fn() },
    inventoryCompartment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === state.compartment.id ? { ...state.compartment } : null)),
      update: vi.fn(async ({ data }: { data: { stockQuantity?: number; lastIssuedAt?: Date | null } }) => {
        Object.assign(state.compartment, data);
        return { ...state.compartment };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'comp-new', ...data })),
    },
    inventoryTransaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'tx-new', ...data })),
    },
  };
  const db = {
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
    inventoryTransaction: { findFirst: vi.fn() },
  };
  return { db, tx, state, tags };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
}

beforeEach(() => {
  vi.mocked(assertMishimaMachine).mockReset();
});

describe('processTransaction tag validation', () => {
  it('requires the restock tag before starting a transaction when restocking', async () => {
    const { db } = makeDb();
    await expect(processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restock: true, restockTagUid: '  ' }))
      .rejects.toMatchObject({ statusCode: 400, message: '補充タグを先に読み取ってください' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('trims scanned UIDs before resolving tags and issues the tag quantity', async () => {
    const { db, state } = makeDb();
    const result = await processTransaction(db as never, { itemTagUid: ' item-uid ', quantityTagUid: '\tqty-uid\n', restock: false });
    expect(result.replayed).toBe(false);
    expect(result.transaction).toMatchObject({ action: 'ISSUE', delta: -5, beforeQuantity: 10, afterQuantity: 5, quantityTagId: 't-qty' });
    expect(state.compartment.stockQuantity).toBe(5);
  });

  it.each([
    ['unknown item tag', { itemTagUid: 'nope' }, 'アイテムNFCタグを読み取ってください'],
    ['quantity tag scanned as the item', { itemTagUid: 'qty-uid' }, 'アイテムNFCタグを読み取ってください'],
    ['item tag scanned as the quantity', { quantityTagUid: 'item-uid' }, '数量NFCタグを読み取ってください'],
    ['unknown quantity tag', { quantityTagUid: 'nope' }, '数量NFCタグを読み取ってください'],
  ])('rejects %s with 400 and no stock change', async (_label, override, message) => {
    const { db, tx, state } = makeDb();
    await expect(processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restock: false, ...override }))
      .rejects.toMatchObject({ statusCode: 400, message });
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(state.compartment.stockQuantity).toBe(10);
  });

  it('rejects an item tag that is no longer bound to a compartment', async () => {
    const { db } = makeDb({ tags: [
      { id: 't-item', uid: 'item-uid', kind: 'ITEM', compartmentId: null, quantity: null },
      { id: 't-qty', uid: 'qty-uid', kind: 'QUANTITY', compartmentId: null, quantity: 5 },
    ] });
    await expect(processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restock: false }))
      .rejects.toMatchObject({ statusCode: 400, message: 'アイテムNFCタグを読み取ってください' });
  });

  it('rejects a quantity tag without a quantity (0 counts as missing)', async () => {
    const { db } = makeDb({ tags: [
      { id: 't-item', uid: 'item-uid', kind: 'ITEM', compartmentId: 'comp-1', quantity: null },
      { id: 't-qty', uid: 'qty-uid', kind: 'QUANTITY', compartmentId: null, quantity: 0 },
    ] });
    await expect(processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restock: false }))
      .rejects.toMatchObject({ statusCode: 400, message: '数量NFCタグを読み取ってください' });
  });

  it('rejects a restock with a non-RESTOCK command tag', async () => {
    const { db, state } = makeDb();
    await expect(processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restockTagUid: 'qty-uid', restock: true }))
      .rejects.toMatchObject({ statusCode: 400, message: '補充NFCタグが不正です' });
    expect(state.compartment.stockQuantity).toBe(10);
  });

  it('restocks with a valid command tag and records the scanned uids', async () => {
    const { db, state } = makeDb();
    const result = await processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restockTagUid: 'restock-uid', restock: true });
    expect(result.transaction).toMatchObject({
      action: 'RESTOCK', delta: 5, beforeQuantity: 10, afterQuantity: 15,
      details: { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restockTagUid: 'restock-uid' },
    });
    expect(state.compartment.stockQuantity).toBe(15);
    expect(state.compartment.lastIssuedAt).toBeNull();
  });
});

describe('processTouchTransaction quantity bounds', () => {
  it('accepts the upper bound 999999 as a restock', async () => {
    const { db, state } = makeDb({ stock: 0 });
    const result = await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 999999, restock: true });
    expect(result.transaction).toMatchObject({ delta: 999999, afterQuantity: 999999, details: { source: 'touch' } });
    expect(state.compartment.stockQuantity).toBe(999999);
  });

  it.each([
    [1000000, '数量は999999以下で指定してください'],
    [0, '数量は1以上の整数で指定してください'],
    [2.5, '数量は1以上の整数で指定してください'],
  ])('rejects quantity %s before opening a transaction', async (quantity, message) => {
    const { db } = makeDb();
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity }))
      .rejects.toMatchObject({ statusCode: 400, message });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a negative expected balance before opening a transaction', async () => {
    const { db } = makeDb();
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, expectedBeforeQuantity: -1 }))
      .rejects.toMatchObject({ statusCode: 400, message: '現在庫は0以上の整数で指定してください' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('allows issuing the whole stock down to exactly zero', async () => {
    const { db, state } = makeDb({ stock: 3 });
    const result = await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 3 });
    expect(result.transaction).toMatchObject({ action: 'ISSUE', delta: -3, beforeQuantity: 3, afterQuantity: 0 });
    expect(state.compartment.stockQuantity).toBe(0);
    expect(state.compartment.lastIssuedAt).toBeInstanceOf(Date);
  });

  it('refuses issuing one more than the stock with INVENTORY_INSUFFICIENT_STOCK', async () => {
    const { db, tx } = makeDb({ stock: 3 });
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 4 }))
      .rejects.toBeInstanceOf(InventoryInsufficientStockError);
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown compartment', async () => {
    const { db } = makeDb();
    await expect(processTouchTransaction(db as never, { compartmentId: 'missing', quantity: 1 }))
      .rejects.toMatchObject({ statusCode: 404, message: '在庫区画が見つかりません' });
  });

  it('checks the machine and stores its id on the transaction', async () => {
    const { db, tx } = makeDb();
    const result = await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, machineId: 'm-1' });
    expect(assertMishimaMachine).toHaveBeenCalledWith(tx, 'm-1');
    expect(result.transaction).toMatchObject({ machineId: 'm-1' });
  });

  it('stops before touching stock when the machine is not allowed', async () => {
    const { db, tx, state } = makeDb();
    vi.mocked(assertMishimaMachine).mockRejectedValueOnce(Object.assign(new Error('三島工場以外の加工機は指定できません'), { statusCode: 400 }));
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, machineId: 'sendai' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(state.compartment.stockQuantity).toBe(10);
  });
});

describe('processStockTransaction idempotency', () => {
  it('does not look up a prior transaction without a client id', async () => {
    const { db, tx } = makeDb();
    await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, idempotencyKey: 'k1' });
    expect(tx.inventoryTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('rethrows a P2002 race when no prior transaction is found on retry lookup', async () => {
    const { db } = makeDb();
    const err = p2002();
    db.$transaction.mockRejectedValueOnce(err);
    db.inventoryTransaction.findFirst.mockResolvedValueOnce(null);
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, idempotencyKey: 'k1', actor: { clientId: 'c1' } }))
      .rejects.toBe(err);
    expect(db.inventoryTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'c1', idempotencyKey: 'k1' } }));
  });

  it('rethrows a P2002 without an idempotency key instead of replaying', async () => {
    const { db } = makeDb();
    const err = p2002();
    db.$transaction.mockRejectedValueOnce(err);
    await expect(processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, actor: { clientId: 'c1' } })).rejects.toBe(err);
    expect(db.inventoryTransaction.findFirst).not.toHaveBeenCalled();
  });
});

describe('cancelTransaction', () => {
  function original(overrides: Record<string, unknown> = {}) {
    return { id: 'tx-1', action: 'RESTOCK', compartmentId: 'comp-1', inventoryItemId: 'item-1', clientId: 'c1', machineId: null, delta: 5, afterQuantity: 10, reversedBy: null, ...overrides };
  }

  it('returns 404 when the transaction is missing or has no compartment', async () => {
    const { db, tx } = makeDb();
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(null);
    await expect(cancelTransaction(db as never, 'tx-1', { clientId: 'c1' })).rejects.toMatchObject({ statusCode: 404 });
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(original({ compartmentId: null }));
    await expect(cancelTransaction(db as never, 'tx-1', { clientId: 'c1' })).rejects.toMatchObject({ statusCode: 404, message: '取引履歴が見つかりません' });
  });

  it('allows an admin (allowAnyClient) to cancel another terminal transaction', async () => {
    const { db, tx, state } = makeDb();
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(original({ clientId: 'other' }));
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' });
    const cancelled = await cancelTransaction(db as never, 'tx-1', { clientId: null, performedByUserId: 'admin' }, { allowAnyClient: true });
    expect(cancelled).toMatchObject({ action: 'CANCEL', delta: -5, beforeQuantity: 10, afterQuantity: 5, reversalOfId: 'tx-1', performedByUserId: 'admin' });
    expect(state.compartment.stockQuantity).toBe(5);
    // Restock cancellation must not touch lastIssuedAt.
    expect(tx.inventoryCompartment.update).toHaveBeenCalledWith({ where: { id: 'comp-1' }, data: { stockQuantity: 5, reorderedAt: null } });
  });

  it('refuses a transaction that is already reversed', async () => {
    const { db, tx, state } = makeDb();
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(original({ reversedBy: { id: 'tx-cancel' } }));
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' });
    await expect(cancelTransaction(db as never, 'tx-1', { clientId: 'c1' })).rejects.toThrow(new InventoryConflictError('直前の取引だけ取消できます'));
    expect(state.compartment.stockQuantity).toBe(10);
  });

  it('refuses when the cancellation would make stock negative', async () => {
    const { db, tx, state } = makeDb({ stock: 2 });
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(original({ delta: 5, afterQuantity: 2 }));
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' });
    await expect(cancelTransaction(db as never, 'tx-1', { clientId: 'c1' })).rejects.toThrow(new InventoryConflictError('取消後の在庫が不正になります'));
    expect(state.compartment.stockQuantity).toBe(2);
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('cancels an issue, restoring stock and falling back to the previous non-cancelled issue time', async () => {
    const previous = new Date('2026-10-01T00:00:00Z');
    const { db, tx, state } = makeDb({ stock: 8 });
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce(original({ action: 'ISSUE', delta: -2, afterQuantity: 8, machineId: 'm-1' }));
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 'tx-1' }).mockResolvedValueOnce({ createdAt: previous });
    const cancelled = await cancelTransaction(db as never, 'tx-1', { clientId: 'c1' });
    expect(cancelled).toMatchObject({ delta: 2, beforeQuantity: 8, afterQuantity: 10, machineId: 'm-1', details: { cancelledTransactionId: 'tx-1' } });
    expect(state.compartment).toMatchObject({ stockQuantity: 10, lastIssuedAt: previous });
  });
});

describe('correctStock', () => {
  it('rejects a negative desired quantity before locking', async () => {
    const { db } = makeDb();
    await expect(correctStock(db as never, 'comp-1', -1, {})).rejects.toMatchObject({ statusCode: 400, message: '在庫数は0以上の整数で指定してください' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('records a negative delta for a downward correction and blank notes as null', async () => {
    const { db, state } = makeDb({ stock: 10 });
    const result = await correctStock(db as never, 'comp-1', 4, { clientId: 'c1' }, '   ');
    expect(result).toMatchObject({ action: 'CORRECTION', delta: -6, beforeQuantity: 10, afterQuantity: 4, details: { note: null } });
    expect(state.compartment.stockQuantity).toBe(4);
  });

  it('returns 404 for an unknown compartment', async () => {
    const { db } = makeDb();
    await expect(correctStock(db as never, 'missing', 1, {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('bindCompartment', () => {
  const drawer = { id: 'd-1', shelfId: 's-1', shelf: { id: 's-1' } };

  it('rejects a blank uid and a negative initial quantity before the transaction', async () => {
    const { db } = makeDb();
    await expect(bindCompartment(db as never, { itemId: 'i', shelfId: 's-1', drawerId: 'd-1', itemTagUid: '  ', initialQuantity: 0 }))
      .rejects.toMatchObject({ statusCode: 400, message: 'アイテムNFC UIDを指定してください' });
    await expect(bindCompartment(db as never, { itemId: 'i', shelfId: 's-1', drawerId: 'd-1', itemTagUid: 'U', initialQuantity: -1 }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 for a soft-deleted item', async () => {
    const { db, tx } = makeDb();
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', deletedAt: new Date('2026-01-01T00:00:00Z') });
    tx.inventoryDrawer.findUnique.mockResolvedValue(drawer);
    await expect(bindCompartment(db as never, { itemId: 'item-1', shelfId: 's-1', drawerId: 'd-1', itemTagUid: 'new', initialQuantity: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(tx.inventoryCompartment.create).not.toHaveBeenCalled();
  });

  it('rejects a drawer that belongs to another shelf', async () => {
    const { db, tx } = makeDb();
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', deletedAt: null });
    tx.inventoryDrawer.findUnique.mockResolvedValue(drawer);
    await expect(bindCompartment(db as never, { itemId: 'item-1', shelfId: 's-OTHER', drawerId: 'd-1', itemTagUid: 'new', initialQuantity: 1 }))
      .rejects.toMatchObject({ statusCode: 400, message: '棚と引き出しの組み合わせが不正です' });
  });

  it.each([
    ['a QUANTITY tag', { id: 't', uid: 'U', kind: 'QUANTITY', compartmentId: null, quantity: 1 }],
    ['an ITEM tag already bound', { id: 't', uid: 'U', kind: 'ITEM', compartmentId: 'comp-9', quantity: null }],
  ] as const)('refuses %s with 409', async (_label, tag) => {
    const { db, tx } = makeDb({ tags: [tag as Tag] });
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', deletedAt: null });
    tx.inventoryDrawer.findUnique.mockResolvedValue(drawer);
    await expect(bindCompartment(db as never, { itemId: 'item-1', shelfId: 's-1', drawerId: 'd-1', itemTagUid: 'U', initialQuantity: 1 }))
      .rejects.toMatchObject({ statusCode: 409, message: 'このUIDは既に使用されています' });
    expect(tx.inventoryCompartment.create).not.toHaveBeenCalled();
  });

  it('creates a new ITEM tag when the uid is unused and records the initial stock', async () => {
    const { db, tx } = makeDb({ tags: [] });
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', deletedAt: null });
    tx.inventoryDrawer.findUnique.mockResolvedValue(drawer);
    const result = await bindCompartment(db as never, { itemId: 'item-1', shelfId: 's-1', drawerId: 'd-1', itemTagUid: ' NEW ', initialQuantity: 7 });
    expect(tx.inventoryNfcTag.create).toHaveBeenCalledWith({ data: { uid: 'NEW', kind: 'ITEM', compartmentId: 'comp-new' } });
    expect(result.compartment).toMatchObject({ stockQuantity: 7, drawerId: 'd-1' });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'REGISTER', delta: 7, beforeQuantity: 0, afterQuantity: 7, details: { binding: 'EXISTING_ITEM', itemTagUid: 'NEW' },
    }) });
  });
});

describe('moveLocation', () => {
  it('records from/to as area/shelf/drawer and keeps the quantity unchanged', async () => {
    const { db, tx } = makeDb();
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 6, drawer: { drawerNumber: 1, shelf: { area: 'A', shelfNumber: 2 } } });
    tx.inventoryDrawer.findUnique.mockResolvedValueOnce({ id: 'd-9', drawerNumber: 3, shelf: { area: 'B', shelfNumber: 4 } });
    const result = await moveLocation(db as never, 'comp-1', 'd-9', { clientId: 'c1' });
    expect(tx.inventoryCompartment.update).toHaveBeenCalledWith({ where: { id: 'comp-1' }, data: { drawerId: 'd-9' } });
    expect(result).toMatchObject({ action: 'LOCATION_CHANGE', beforeQuantity: 6, afterQuantity: 6, details: { from: 'A/2/1', to: 'B/4/3' } });
  });

  it('returns 404 without updating when the destination drawer is missing', async () => {
    const { db, tx } = makeDb();
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', drawer: { drawerNumber: 1, shelf: { area: 'A', shelfNumber: 2 } } });
    tx.inventoryDrawer.findUnique.mockResolvedValueOnce(null);
    await expect(moveLocation(db as never, 'comp-1', 'd-x', {})).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
  });
});

describe('replaceItemTag', () => {
  it('rejects a blank uid', async () => {
    const { db } = makeDb();
    await expect(replaceItemTag(db as never, 'comp-1', ' ', {})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reports where a uid is already used by another compartment', async () => {
    const { db, tx } = makeDb();
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', stockQuantity: 1, itemTag: null });
    tx.inventoryNfcTag.findUnique.mockResolvedValueOnce({
      id: 't-x', uid: 'U', compartmentId: 'comp-2',
      compartment: { inventoryItem: { name: 'エンドミル' }, drawer: { drawerNumber: 3, shelf: { area: 'A', shelfNumber: 5 } } },
    });
    await expect(replaceItemTag(db as never, 'comp-1', 'U', {})).rejects.toMatchObject({
      statusCode: 409,
      details: { usedBy: { itemName: 'エンドミル', area: 'A', shelfNumber: 5, drawerNumber: 3 } },
    });
    expect(tx.inventoryNfcTag.update).not.toHaveBeenCalled();
  });

  it('releases the old tag, creates a new ITEM tag for an unused uid and logs both uids', async () => {
    const { db, tx } = makeDb({ tags: [] });
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 4, itemTag: { id: 't-old', uid: 'OLD' } });
    const tag = await replaceItemTag(db as never, 'comp-1', ' NEW ', { clientId: 'c1' });
    expect(tx.inventoryNfcTag.update).toHaveBeenCalledWith({ where: { id: 't-old' }, data: { compartmentId: null } });
    expect(tx.inventoryNfcTag.create).toHaveBeenCalledWith({ data: { uid: 'NEW', kind: 'ITEM', compartmentId: 'comp-1' } });
    expect(tag).toMatchObject({ uid: 'NEW', kind: 'ITEM' });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'TAG_REPLACEMENT', beforeQuantity: 4, afterQuantity: 4, details: { previousUid: 'OLD', uid: 'NEW' },
    }) });
  });

  it('re-scanning the tag already on the compartment keeps it bound without releasing it', async () => {
    const { db, tx } = makeDb();
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 4, itemTag: { id: 't-item', uid: 'item-uid' } });
    await replaceItemTag(db as never, 'comp-1', 'item-uid', {});
    expect(tx.inventoryNfcTag.update).toHaveBeenCalledTimes(1);
    expect(tx.inventoryNfcTag.update).toHaveBeenCalledWith({ where: { id: 't-item' }, data: { kind: 'ITEM', compartmentId: 'comp-1' } });
    expect(tx.inventoryNfcTag.create).not.toHaveBeenCalled();
  });

  it('reuses a released ITEM tag (no compartment) like bindCompartment does', async () => {
    const { db, tx } = makeDb({ tags: [{ id: 't-free', uid: 'FREE', kind: 'ITEM', compartmentId: null, quantity: null }] });
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 4, itemTag: { id: 't-old', uid: 'OLD' } });
    const tag = await replaceItemTag(db as never, 'comp-1', 'FREE', { clientId: 'c1' });
    expect(tx.inventoryNfcTag.update).toHaveBeenNthCalledWith(1, { where: { id: 't-old' }, data: { compartmentId: null } });
    expect(tx.inventoryNfcTag.update).toHaveBeenNthCalledWith(2, { where: { id: 't-free' }, data: { kind: 'ITEM', compartmentId: 'comp-1' } });
    expect(tx.inventoryNfcTag.create).not.toHaveBeenCalled();
    expect(tag).toMatchObject({ id: 't-free', uid: 'FREE', kind: 'ITEM', compartmentId: 'comp-1' });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'TAG_REPLACEMENT', details: { previousUid: 'OLD', uid: 'FREE' },
    }) });
  });

  it('refuses a released ITEM tag that another compartment claimed first', async () => {
    const { db, tx } = makeDb({ tags: [{ id: 't-free', uid: 'FREE', kind: 'ITEM', compartmentId: null, quantity: null }] });
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 4, itemTag: { id: 't-old', uid: 'OLD' } });
    tx.inventoryNfcTag.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(replaceItemTag(db as never, 'comp-1', 'FREE', {})).rejects.toMatchObject({ statusCode: 409, message: 'このUIDは既に使用されています' });
    expect(tx.inventoryNfcTag.updateMany).toHaveBeenCalledWith({ where: { id: 't-free', compartmentId: null }, data: { compartmentId: 'comp-1' } });
    expect(tx.inventoryNfcTag.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it.each(['QUANTITY', 'RESTOCK'])('still refuses an unbound %s tag with 409', async (kind) => {
    const { db, tx } = makeDb();
    tx.inventoryCompartment.findUnique.mockResolvedValueOnce({ id: 'comp-1', inventoryItemId: 'item-1', stockQuantity: 4, itemTag: null });
    tx.inventoryNfcTag.findUnique.mockResolvedValueOnce({ id: 't-q', uid: 'Q', kind, compartmentId: null, compartment: null });
    await expect(replaceItemTag(db as never, 'comp-1', 'Q', {})).rejects.toMatchObject({ statusCode: 409, message: 'このUIDは既に使用されています' });
    expect(tx.inventoryNfcTag.update).not.toHaveBeenCalled();
    expect(tx.inventoryNfcTag.create).not.toHaveBeenCalled();
  });
});


describe('reorder state on every stock path', () => {
  const orderedAt = new Date('2026-11-04T00:00:00Z');

  it.each(['touch restock', 'NFC restock', 'correction', 'cancel', 'offline replay', 'issue'] as const)('clears ordered above the threshold: %s', async (path) => {
    const { db, tx, state } = makeDb({ stock: path === 'issue' ? 12 : 5, reorderPoint: 5, reorderedAt: orderedAt });
    if (path === 'touch restock' || path === 'offline replay') await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, restock: true, idempotencyKey: 'offline-k1', actor: { clientId: 'c1' } });
    if (path === 'NFC restock') await processTransaction(db as never, { itemTagUid: 'item-uid', quantityTagUid: 'qty-uid', restockTagUid: 'restock-uid', restock: true });
    if (path === 'correction') await correctStock(db as never, 'comp-1', 6, {});
    if (path === 'issue') await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1 });
    if (path === 'cancel') {
      tx.inventoryTransaction.findUnique.mockResolvedValueOnce({ id: 't1', action: 'ISSUE', compartmentId: 'comp-1', inventoryItemId: 'item-1', delta: -1, afterQuantity: 5, clientId: 'c1', reversedBy: null });
      tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 't1' });
      await cancelTransaction(db as never, 't1', { clientId: 'c1' });
    }
    expect(state.compartment.stockQuantity).toBeGreaterThan(5);
    expect(state.compartment.reorderedAt).toBeNull();
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it.each([4, 5])('keeps ordered at or below the threshold after a correction to %s', async quantity => {
    const { db, state } = makeDb({ reorderPoint: 5, reorderedAt: orderedAt });
    await correctStock(db as never, 'comp-1', quantity, {});
    expect(state.compartment.reorderedAt).toEqual(orderedAt);
  });

  it('keeps ordered after issuing, restocking exactly to the threshold and cancelling a restock', async () => {
    const { db, tx, state } = makeDb({ stock: 5, reorderPoint: 5, reorderedAt: orderedAt });
    await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1 });
    await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 1, restock: true });
    expect(state.compartment.reorderedAt).toEqual(orderedAt);
    tx.inventoryTransaction.findUnique.mockResolvedValueOnce({ id: 't1', action: 'RESTOCK', compartmentId: 'comp-1', inventoryItemId: 'item-1', delta: 1, afterQuantity: 5, clientId: 'c1', reversedBy: null });
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce({ id: 't1' });
    await cancelTransaction(db as never, 't1', { clientId: 'c1' });
    expect(state.compartment).toMatchObject({ stockQuantity: 4, reorderedAt: orderedAt });
  });

  it.each([null, 4, 5, 6])('re-evaluates ordered after setting threshold %s', async reorderPoint => {
    const { db, state } = makeDb({ stock: 5, reorderPoint: 5, reorderedAt: orderedAt });
    await setReorderPoint(db as never, 'comp-1', reorderPoint);
    expect(state.compartment.reorderPoint).toBe(reorderPoint);
    expect(state.compartment.reorderedAt).toEqual(reorderPoint == null || reorderPoint < 5 ? null : orderedAt);
  });

  it.each([-1, 1.5, 2147483648])('rejects an invalid threshold %s', async point => {
    const { db } = makeDb();
    await expect(setReorderPoint(db as never, 'comp-1', point)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([null, 4])('refuses ordered ON without low stock, threshold %s', async reorderPoint => {
    const { db, tx } = makeDb({ stock: 5, reorderPoint });
    await expect(setOrdered(db as never, 'comp-1', true)).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
  });

  it.each([0, 4, 5])('sets a timestamp below or at the threshold, stock %s; repeated ON preserves it; OFF clears it', async stock => {
    const { db, state } = makeDb({ stock, reorderPoint: 5 });
    await setOrdered(db as never, 'comp-1', true);
    const timestamp = state.compartment.reorderedAt;
    expect(timestamp).toBeInstanceOf(Date);
    await setOrdered(db as never, 'comp-1', true);
    expect(state.compartment.reorderedAt).toEqual(timestamp);
    await setOrdered(db as never, 'comp-1', false);
    expect(state.compartment.reorderedAt).toBeNull();
  });

  it('allows zero as the threshold and OFF without a threshold', async () => {
    const { db, state } = makeDb({ stock: 0 });
    await setReorderPoint(db as never, 'comp-1', 0);
    await setOrdered(db as never, 'comp-1', true);
    expect(state.compartment.reorderedAt).toBeInstanceOf(Date);
    await setReorderPoint(db as never, 'comp-1', null);
    await setOrdered(db as never, 'comp-1', false);
    expect(state.compartment.reorderedAt).toBeNull();
  });

  it('returns 404 for unknown compartments on either setting operation', async () => {
    const { db } = makeDb();
    await expect(setReorderPoint(db as never, 'missing', 0)).rejects.toMatchObject({ statusCode: 404 });
    await expect(setOrdered(db as never, 'missing', false)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns an offline retry without restocking twice or changing the new order state', async () => {
    const { db, tx, state } = makeDb({ stock: 5, reorderPoint: 5, reorderedAt: orderedAt });
    const prior = { id: 'prior', action: 'RESTOCK', afterQuantity: 5 };
    tx.inventoryTransaction.findFirst.mockResolvedValueOnce(prior);
    expect(await processTouchTransaction(db as never, { compartmentId: 'comp-1', quantity: 5, restock: true, idempotencyKey: 'offline-k1', actor: { clientId: 'c1' } })).toEqual({ transaction: prior, replayed: true });
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(state.compartment.reorderedAt).toEqual(orderedAt);
  });
});
