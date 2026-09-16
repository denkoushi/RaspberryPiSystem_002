import { describe, expect, it, vi } from 'vitest';

import { ItemInventoryService } from '../item-inventory.service.js';

function transactionDb(overrides: Record<string, unknown> = {}) {
  const tx = {
    employee: { findFirst: vi.fn().mockResolvedValue(null) },
    item: { findFirst: vi.fn().mockResolvedValue(null) },
    measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
    riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
    inventoryNfcTag: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    },
    inventoryTransaction: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    inventoryCompartment: { findUnique: vi.fn(), update: vi.fn() },
    ...overrides,
  };
  const db = {
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { db, tx };
}

describe('ItemInventoryService safety boundaries', () => {
  it('rejects a quantity tag UID already owned by another NFC domain', async () => {
    const { db, tx } = transactionDb();
    tx.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
    const service = new ItemInventoryService(db as never);

    await expect(service.upsertQuantityTag('shared-uid', 20)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.inventoryNfcTag.upsert).not.toHaveBeenCalled();
  });

  it('does not let a kiosk cancel another terminal transaction', async () => {
    const { db, tx } = transactionDb();
    tx.inventoryTransaction.findUnique.mockResolvedValue({
      id: 'transaction-1',
      compartmentId: 'compartment-1',
      clientId: 'terminal-a',
      delta: -2,
      afterQuantity: 8,
      reversedBy: null,
    });
    const service = new ItemInventoryService(db as never);

    await expect(service.cancelTransaction('transaction-1', { clientId: 'terminal-b' })).rejects.toThrow('この端末');
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
  });

  it('returns flattened registered compartment and location fields', async () => {
    const item = {
      id: 'item-1',
      itemCode: 'RI-2-TEST',
      name: '治具',
      model: 'M-1',
      usage: '検査',
      category: '治具',
      area: '30007_KSJP-55',
      note: '共有',
      photos: [],
    };
    const compartment = {
      id: 'compartment-1',
      stockQuantity: 4,
      drawer: { id: 'drawer-1', shelfId: 'shelf-1', drawerNumber: 3, shelf: { area: item.area, shelfNumber: 2 } },
      itemTag: { uid: 'item-uid' },
      inventoryItem: item,
    };
    const db = {
      inventoryItem: { findMany: vi.fn().mockResolvedValue([{ ...item, compartments: [compartment] }]) },
      inventoryShelf: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'shelf-1',
          area: item.area,
          shelfNumber: 2,
          drawers: [{ id: 'drawer-1', shelfId: 'shelf-1', drawerNumber: 3, compartments: [compartment] }],
        }]),
      },
    };
    const service = new ItemInventoryService(db as never);

    await expect(service.listItems()).resolves.toMatchObject([{
      id: item.id,
      compartments: [{
        id: compartment.id,
        area: item.area,
        shelfNumber: 2,
        drawerNumber: 3,
        itemTagUid: 'item-uid',
        item: { id: item.id, name: item.name, model: item.model, usage: item.usage },
      }],
    }]);
    await expect(service.listLocations()).resolves.toMatchObject([{
      drawers: [{
        shelf: { area: item.area, shelfNumber: 2 },
        compartments: [{ id: compartment.id, area: item.area, shelfNumber: 2, drawerNumber: 3, itemTagUid: 'item-uid' }],
      }],
    }]);
  });

  it('preserves existing item metadata, stock, and compartment on photo-only registration', async () => {
    const existing = {
      id: 'item-1',
      itemCode: 'RI-2-TEST',
      name: '既存治具',
      model: 'M-1',
      usage: '検査',
      category: '治具',
      area: '30007_KSJP-55',
      note: '既存メモ',
      compartments: [{ id: 'compartment-1', stockQuantity: 7, drawerId: 'drawer-1' }],
    };
    const payload = {
      id: 'payload-1',
      status: 'PENDING',
      category: null,
      note: null,
      photos: [{ id: 'photo-1', photoUrl: '/photos/photo.jpg', filename: 'photo.jpg', sha256: 'a'.repeat(64) }],
    };
    const photoCreate = vi.fn().mockResolvedValue({ id: 'item-photo-1' });
    const tx = {
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(existing, data);
          return existing;
        }),
      },
      inventoryItemPhoto: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: photoCreate,
      },
      inventoryImportPayload: { update: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      inventoryImportPayload: { findUnique: vi.fn().mockResolvedValue(payload) },
      $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const service = new ItemInventoryService(db as never);

    await service.registerImport({ payloadId: payload.id, mode: 'EXISTING_ITEM', itemId: existing.id });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: existing.id }, data: {} });
    expect(existing).toMatchObject({
      name: '既存治具', model: 'M-1', usage: '検査', category: '治具', note: '既存メモ',
      compartments: [{ id: 'compartment-1', stockQuantity: 7, drawerId: 'drawer-1' }],
    });
    expect(photoCreate).toHaveBeenCalledTimes(1);
  });

  it('binds an existing item to a compartment and records its initial stock', async () => {
    const item = { id: 'item-1', itemCode: 'RI-2-TEST', name: '既存治具' };
    const drawer = {
      id: 'drawer-1',
      shelfId: 'shelf-1',
      drawerNumber: 3,
      shelf: { area: '30007_KSJP-55', shelfNumber: 2 },
    };
    const compartment = { id: 'compartment-1', drawerId: drawer.id, inventoryItemId: item.id, stockQuantity: 4 };
    const tag = { id: 'tag-1', uid: 'item-uid', kind: 'ITEM', compartmentId: compartment.id };
    const transaction = { id: 'transaction-1', action: 'REGISTER' };
    const tx = {
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
      item: { findFirst: vi.fn().mockResolvedValue(null) },
      measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
      riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: vi.fn().mockResolvedValue(item) },
      inventoryDrawer: { findUnique: vi.fn().mockResolvedValue(drawer) },
      inventoryCompartment: { create: vi.fn().mockResolvedValue(compartment) },
      inventoryNfcTag: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(tag),
      },
      inventoryTransaction: { create: vi.fn().mockResolvedValue(transaction) },
    };
    const db = {
      $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const service = new ItemInventoryService(db as never);

    await expect(service.bindCompartment({
      itemId: item.id,
      shelfId: drawer.shelfId,
      drawerId: drawer.id,
      itemTagUid: ' item-uid ',
      initialQuantity: 4,
      actor: { clientId: 'terminal-1', performedByUserId: 'user-1' },
    })).resolves.toMatchObject({ item, compartment, tag });

    expect(tx.inventoryCompartment.create).toHaveBeenCalledWith({
      data: { drawerId: drawer.id, inventoryItemId: item.id, stockQuantity: 4 },
    });
    expect(tx.inventoryNfcTag.create).toHaveBeenCalledWith({
      data: { uid: 'item-uid', kind: 'ITEM', compartmentId: compartment.id },
    });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REGISTER',
        inventoryItemId: item.id,
        compartmentId: compartment.id,
        clientId: 'terminal-1',
        performedByUserId: 'user-1',
        delta: 4,
        beforeQuantity: 0,
        afterQuantity: 4,
        details: { binding: 'EXISTING_ITEM', itemTagUid: 'item-uid' },
      }),
    });
  });
});

function inventoryState(stockQuantity = 10) {
  const state = {
    compartment: { id: 'compartment-1', inventoryItemId: 'item-1', stockQuantity },
    tags: new Map([
      ['item-uid', { id: 'item-tag-1', uid: 'item-uid', kind: 'ITEM', compartmentId: 'compartment-1' }],
      ['quantity-uid', { id: 'quantity-tag-1', uid: 'quantity-uid', kind: 'QUANTITY', quantity: 2, compartmentId: null }],
      ['restock-uid', { id: 'restock-tag-1', uid: 'restock-uid', kind: 'RESTOCK', quantity: null, compartmentId: null }],
    ]),
    transactions: [] as Array<Record<string, any>>,
  };
  const tx = {
    inventoryNfcTag: {
      findUnique: vi.fn(async ({ where }: { where: { uid: string } }) => {
        const tag = state.tags.get(where.uid);
        return tag ? { ...tag, compartment: tag.compartmentId ? { ...state.compartment } : null } : null;
      }),
    },
    inventoryCompartment: {
      findUnique: vi.fn(async () => ({ ...state.compartment })),
      update: vi.fn(async ({ data }: { data: { stockQuantity: number } }) => {
        state.compartment.stockQuantity = data.stockQuantity;
        return { ...state.compartment };
      }),
    },
    inventoryTransaction: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.transactions.find((entry) => entry.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where }: { where: { clientId?: string; idempotencyKey?: string; compartmentId?: string } }) => {
        if (where.idempotencyKey) return state.transactions.find((entry) => entry.clientId === where.clientId && entry.idempotencyKey === where.idempotencyKey) ?? null;
        if (where.compartmentId) return [...state.transactions].reverse().find((entry) => entry.compartmentId === where.compartmentId) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        const transaction = { id: `transaction-${state.transactions.length + 1}`, createdAt: new Date(), ...data, reversedBy: null };
        state.transactions.push(transaction);
        return transaction;
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)), inventoryTransaction: tx.inventoryTransaction };
  return { state, tx, db };
}

describe('ItemInventoryService stock transactions', () => {
  it('records issue and restock before/after balances independently', async () => {
    const { state, db } = inventoryState();
    const service = new ItemInventoryService(db as never);

    const issue = await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'issue-1', actor: { clientId: 'terminal-1' } });
    const restock = await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restockTagUid: 'restock-uid', restock: true, idempotencyKey: 'restock-1', actor: { clientId: 'terminal-1' } });

    expect(issue.transaction).toMatchObject({ delta: -2, beforeQuantity: 10, afterQuantity: 8, action: 'ISSUE' });
    expect(restock.transaction).toMatchObject({ delta: 2, beforeQuantity: 8, afterQuantity: 10, action: 'RESTOCK' });
    expect(state.compartment.stockQuantity).toBe(10);
    expect(state.transactions).toHaveLength(2);
  });

  it('rejects insufficient stock without updating the balance or writing history', async () => {
    const { state, tx, db } = inventoryState(1);
    const service = new ItemInventoryService(db as never);

    await expect(service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, actor: { clientId: 'terminal-1' } })).rejects.toThrow('在庫が不足しています');
    expect(state.compartment.stockQuantity).toBe(1);
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('replays the same kiosk idempotency key without a second decrement', async () => {
    const { state, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const input = { itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'same-key', actor: { clientId: 'terminal-1' } };

    const first = await service.processTransaction(input);
    const second = await service.processTransaction(input);

    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(state.compartment.stockQuantity).toBe(8);
    expect(state.transactions).toHaveLength(1);
  });

  it('refuses cancellation when a newer transaction changed the balance', async () => {
    const { db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const first = await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'issue-1', actor: { clientId: 'terminal-1' } });
    await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'issue-2', actor: { clientId: 'terminal-1' } });

    await expect(service.cancelTransaction(first.transaction.id, { clientId: 'terminal-1' })).rejects.toThrow('在庫が更新されています');
  });
});
