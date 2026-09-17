import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { deletePhoto: vi.fn().mockResolvedValue(undefined) } }));

import { ItemInventoryService } from '../item-inventory.service.js';
import { PhotoStorage } from '../../../lib/photo-storage.js';

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

  it('soft-deletes an item, releases only its item tags, and keeps transaction history attached', async () => {
    const item = { id: 'item-1', deletedAt: null };
    const tx = {
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        update: vi.fn().mockResolvedValue({ ...item, deletedAt: new Date() }),
      },
      inventoryCompartment: {
        findMany: vi.fn().mockResolvedValue([{ id: 'compartment-1' }, { id: 'compartment-2' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      inventoryNfcTag: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      inventoryTransaction: { deleteMany: vi.fn() },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);

    await expect(service.deleteItem(item.id)).resolves.toEqual({ id: item.id });

    expect(tx.inventoryNfcTag.updateMany).toHaveBeenCalledWith({
      where: { compartmentId: { in: ['compartment-1', 'compartment-2'] } },
      data: { compartmentId: null },
    });
    expect(tx.inventoryCompartment.deleteMany).toHaveBeenCalledWith({ where: { inventoryItemId: item.id } });
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: item.id }, data: { deletedAt: expect.any(Date) } });
    expect(tx.inventoryTransaction.deleteMany).not.toHaveBeenCalled();
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
      inventoryImportPayload: {
        findUnique: vi.fn().mockResolvedValue(payload),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const db = {
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
    expect(photoCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ photoIndex: 1 }) });
  });

  it('allows only one of two concurrent registrations to claim the candidate', async () => {
    let claimed = false;
    const itemCreate = vi.fn().mockResolvedValue({ id: 'item-1', itemCode: 'RI-2-TEST' });
    const compartmentCreate = vi.fn().mockResolvedValue({ id: 'compartment-1', stockQuantity: 0 });
    const tagCreate = vi.fn().mockResolvedValue({ id: 'tag-1', uid: 'item-uid', kind: 'ITEM', compartmentId: 'compartment-1' });
    const tx = {
      inventoryImportPayload: {
        findUnique: vi.fn().mockResolvedValue({ id: 'payload-1', status: 'PENDING', sourceItemId: 2, area: 'A', category: null, note: null, photos: [] }),
        updateMany: vi.fn().mockImplementation(async () => {
          if (claimed) return { count: 0 };
          claimed = true;
          return { count: 1 };
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      inventoryDrawer: { findUnique: vi.fn().mockResolvedValue({ id: 'drawer-1', shelfId: 'shelf-1', shelf: { area: 'A' } }) },
      inventoryItem: { create: itemCreate },
      inventoryCompartment: { create: compartmentCreate },
      inventoryNfcTag: { findUnique: vi.fn().mockResolvedValue(null), create: tagCreate },
      inventoryTransaction: { create: vi.fn().mockResolvedValue({}) },
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
      item: { findFirst: vi.fn().mockResolvedValue(null) },
      measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
      riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);

    const results = await Promise.allSettled([
      service.registerImport({ payloadId: 'payload-1', mode: 'NEW_ITEM', shelfId: 'shelf-1', drawerId: 'drawer-1', itemTagUid: 'item-uid', initialQuantity: 0 }),
      service.registerImport({ payloadId: 'payload-1', mode: 'NEW_ITEM', shelfId: 'shelf-1', drawerId: 'drawer-1', itemTagUid: 'item-uid', initialQuantity: 0 }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
    expect(itemCreate).toHaveBeenCalledTimes(1);
    expect(compartmentCreate).toHaveBeenCalledTimes(1);
    expect(tagCreate).toHaveBeenCalledTimes(1);
  });

  it('deletes a pending photo, compacts its order, and removes an unreferenced file', async () => {
    const remaining = [{ id: 'photo-2', photoIndex: 2, createdAt: new Date(), photoUrl: '/api/storage/photos/two.jpg' }];
    const tx = {
      inventoryImportPayload: { findUnique: vi.fn().mockResolvedValue({ status: 'PENDING' }) },
      inventoryImportPhoto: {
        findFirst: vi.fn().mockResolvedValue({ id: 'photo-1', photoUrl: '/api/storage/photos/one.jpg' }),
        findMany: vi.fn().mockResolvedValue(remaining),
        delete: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      inventoryItemPhoto: { count: vi.fn().mockResolvedValue(0) },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);

    await expect(service.deleteImportPhoto('payload-1', 'photo-1')).resolves.toEqual({ photoId: 'photo-1' });

    expect(tx.inventoryImportPhoto.delete).toHaveBeenCalledWith({ where: { id: 'photo-1' } });
    expect(tx.inventoryImportPhoto.update).toHaveBeenNthCalledWith(1, { where: { id: 'photo-2' }, data: { photoIndex: -1 } });
    expect(tx.inventoryImportPhoto.update).toHaveBeenNthCalledWith(2, { where: { id: 'photo-2' }, data: { photoIndex: 1 } });
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledWith('/api/storage/photos/one.jpg');
  });

  it('reorders every photo in a pending candidate and rejects incomplete orders', async () => {
    const photos = [
      { id: 'photo-1', photoIndex: 1, createdAt: new Date(1) },
      { id: 'photo-2', photoIndex: 2, createdAt: new Date(2) },
    ];
    const tx = {
      inventoryImportPayload: { findUnique: vi.fn().mockResolvedValue({ status: 'PENDING' }) },
      inventoryImportPhoto: { findMany: vi.fn().mockResolvedValue(photos), update: vi.fn() },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);

    await expect(service.reorderImportPhotos('payload-1', ['photo-2', 'photo-1'])).resolves.toEqual({ payloadId: 'payload-1', photoIds: ['photo-2', 'photo-1'] });
    await expect(service.reorderImportPhotos('payload-1', ['photo-2'])).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.inventoryImportPhoto.update).toHaveBeenCalledWith({ where: { id: 'photo-2' }, data: { photoIndex: 1 } });
    expect(tx.inventoryImportPhoto.update).toHaveBeenCalledWith({ where: { id: 'photo-1' }, data: { photoIndex: 2 } });
  });

  it('deletes and reorders registered photos without deleting a still-referenced file', async () => {
    const tx = {
      inventoryItemPhoto: {
        findFirst: vi.fn().mockResolvedValue({ id: 'item-photo-1', inventoryItemId: 'item-1', photoUrl: '/photos/shared.jpg' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'item-photo-2', photoIndex: 2, createdAt: new Date() }]),
        delete: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      inventoryImportPhoto: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);
    vi.mocked(PhotoStorage.deletePhoto).mockClear();

    await service.deleteInventoryItemPhoto('item-1', 'item-photo-1');
    expect(tx.inventoryItemPhoto.delete).toHaveBeenCalledWith({ where: { id: 'item-photo-1' } });
    expect(PhotoStorage.deletePhoto).not.toHaveBeenCalled();

    const reorderTx = {
      inventoryItemPhoto: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'item-photo-1', photoIndex: 1, createdAt: new Date(1) },
          { id: 'item-photo-2', photoIndex: 2, createdAt: new Date(2) },
        ]),
        update: vi.fn(),
      },
    };
    const reorderDb = { $transaction: vi.fn(async (work: (value: typeof reorderTx) => Promise<unknown>) => work(reorderTx)) };
    await new ItemInventoryService(reorderDb as never).reorderInventoryItemPhotos('item-1', ['item-photo-2', 'item-photo-1']);
    expect(reorderTx.inventoryItemPhoto.update).toHaveBeenCalledWith({ where: { id: 'item-photo-2' }, data: { photoIndex: 1 } });
    expect(reorderTx.inventoryItemPhoto.update).toHaveBeenCalledWith({ where: { id: 'item-photo-1' }, data: { photoIndex: 2 } });
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

  it('reassigns an item tag released by item deletion', async () => {
    const item = { id: 'item-2', itemCode: 'RI-2-OTHER', name: '再割当治具', deletedAt: null };
    const drawer = { id: 'drawer-2', shelfId: 'shelf-2', drawerNumber: 4, shelf: { area: 'A', shelfNumber: 1 } };
    const compartment = { id: 'compartment-2', drawerId: drawer.id, inventoryItemId: item.id, stockQuantity: 0 };
    const releasedTag = { id: 'tag-released', uid: 'released-item-uid', kind: 'ITEM', compartmentId: null };
    const tx = {
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
      item: { findFirst: vi.fn().mockResolvedValue(null) },
      measuringInstrumentTag: { findFirst: vi.fn().mockResolvedValue(null) },
      riggingGearTag: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: vi.fn().mockResolvedValue(item) },
      inventoryDrawer: { findUnique: vi.fn().mockResolvedValue(drawer) },
      inventoryCompartment: { create: vi.fn().mockResolvedValue(compartment) },
      inventoryNfcTag: {
        findUnique: vi.fn().mockResolvedValue(releasedTag),
        update: vi.fn().mockResolvedValue({ ...releasedTag, compartmentId: compartment.id }),
        create: vi.fn(),
      },
      inventoryTransaction: { create: vi.fn().mockResolvedValue({ id: 'transaction-2' }) },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };

    await new ItemInventoryService(db as never).bindCompartment({
      itemId: item.id,
      shelfId: drawer.shelfId,
      drawerId: drawer.id,
      itemTagUid: releasedTag.uid,
      initialQuantity: 0,
    });

    expect(tx.inventoryNfcTag.update).toHaveBeenCalledWith({
      where: { id: releasedTag.id },
      data: { compartmentId: compartment.id },
    });
    expect(tx.inventoryNfcTag.create).not.toHaveBeenCalled();
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
