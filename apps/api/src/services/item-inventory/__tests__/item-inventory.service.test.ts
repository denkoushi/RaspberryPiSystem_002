import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { deletePhoto: vi.fn().mockResolvedValue(undefined) } }));

import { normalizeInventoryArea } from '../inventory-area.js';
import { InventoryConflictError, ItemInventoryService } from '../item-inventory.service.js';
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
      labelNumber: 42,
      stockQuantity: 4,
      drawer: { id: 'drawer-1', shelfId: 'shelf-1', drawerNumber: 3, shelf: { area: item.area, shelfNumber: 2 } },
      itemTag: { uid: 'item-uid' },
      inventoryItem: item,
    };
    const db = {
      inventoryNfcTag: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tag-1', uid: 'item-uid', kind: 'ITEM', quantity: null, compartment }),
        findMany: vi.fn().mockResolvedValue([{ id: 'tag-1', uid: 'item-uid', kind: 'ITEM', quantity: null, compartment }]),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([{ ...item, compartments: [compartment] }]) },
      inventoryTransaction: { groupBy: vi.fn().mockResolvedValue([]) },
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
        labelNumber: 42,
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
        compartments: [{ id: compartment.id, labelNumber: 42, area: item.area, shelfNumber: 2, drawerNumber: 3, itemTagUid: 'item-uid' }],
      }],
    }]);
    await expect(service.resolveTag('item-uid')).resolves.toMatchObject({ compartment: { labelNumber: 42 } });
    await expect(service.listTags()).resolves.toMatchObject([{ compartment: { labelNumber: 42 } }]);
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
    compartment: { id: 'compartment-1', inventoryItemId: 'item-1', stockQuantity, lastIssuedAt: null as Date | null },
    tags: new Map([
      ['item-uid', { id: 'item-tag-1', uid: 'item-uid', kind: 'ITEM', compartmentId: 'compartment-1' }],
      ['quantity-uid', { id: 'quantity-tag-1', uid: 'quantity-uid', kind: 'QUANTITY', quantity: 2, compartmentId: null }],
      ['restock-uid', { id: 'restock-tag-1', uid: 'restock-uid', kind: 'RESTOCK', quantity: null, compartmentId: null }],
    ]),
    transactions: [] as Array<Record<string, any>>,
  };
  const withRelations = (transaction: Record<string, any> | null, include?: Prisma.InventoryTransactionInclude) => transaction && ({
    ...transaction,
    ...(include?.inventoryItem ? { inventoryItem: { itemCode: 'RI-2-TEST', name: '治具' } } : {}),
    ...(include?.compartment ? { compartment: { ...state.compartment, drawer: { drawerNumber: 2, shelf: { area: '30007_KSJP-55', shelfNumber: 1 } } } } : {}),
  });
  const tx = {
    inventoryNfcTag: {
      findUnique: vi.fn(async ({ where }: { where: { uid: string } }) => {
        const tag = state.tags.get(where.uid);
        return tag ? { ...tag, compartment: tag.compartmentId ? { ...state.compartment } : null } : null;
      }),
    },
    inventoryCompartment: {
      findUnique: vi.fn(async () => ({ ...state.compartment })),
      update: vi.fn(async ({ data }: { data: { stockQuantity: number; lastIssuedAt?: Date | null } }) => {
        Object.assign(state.compartment, data);
        return { ...state.compartment };
      }),
    },
    inventoryTransaction: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.transactions.find((entry) => entry.id === where.id) ?? null),
      findFirst: vi.fn(async ({ where, include }: { where: { clientId?: string; idempotencyKey?: string; compartmentId?: string; action?: string; id?: { not: string }; reversedBy?: { is: null } }; include?: Prisma.InventoryTransactionInclude }) => {
        if (where.idempotencyKey) return withRelations(state.transactions.find((entry) => entry.clientId === where.clientId && entry.idempotencyKey === where.idempotencyKey) ?? null, include);
        if (where.compartmentId) return [...state.transactions].reverse().find((entry) => entry.compartmentId === where.compartmentId
          && (!where.action || entry.action === where.action)
          && (!where.id || entry.id !== where.id.not)
          && (!where.reversedBy || !entry.reversedBy)) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data, include }: { data: Record<string, any>; include?: Prisma.InventoryTransactionInclude }) => {
        const transaction = { id: `transaction-${state.transactions.length + 1}`, createdAt: new Date(), ...data, reversedBy: null };
        if (data.reversalOfId) {
          const original = state.transactions.find((entry) => entry.id === data.reversalOfId);
          if (original) original.reversedBy = { id: transaction.id };
        }
        state.transactions.push(transaction);
        return withRelations(transaction, include);
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)), inventoryTransaction: tx.inventoryTransaction };
  return { state, tx, db };
}

describe('ItemInventoryService stock transactions', () => {
  it.each(['nfc', 'touch'] as const)('returns history relations for fresh %s movements, replays and cancellation', async (source) => {
    const { state, tx, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const actor = { clientId: 'terminal-1' };
    const move = () => source === 'nfc'
      ? service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'movement-key', actor })
      : service.processTouchTransaction({ compartmentId: 'compartment-1', quantity: 2, idempotencyKey: 'movement-key', actor });
    const fresh = await move();
    const replay = await move();
    const cancelled = await service.cancelTransaction(fresh.transaction.id, actor);

    for (const transaction of [fresh.transaction, replay.transaction, cancelled]) {
      expect(transaction.inventoryItem.name).toBe('治具');
      expect(transaction.compartment).toMatchObject({ drawer: { drawerNumber: 2, shelf: { area: '30007_KSJP-55', shelfNumber: 1 } } });
    }
    expect(replay.replayed).toBe(true);
    expect(state.compartment.stockQuantity).toBe(10);
    expect(state.transactions).toHaveLength(2);
    const include = { inventoryItem: true, compartment: { include: { drawer: { include: { shelf: true } } } } };
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ include }));
    expect(tx.inventoryTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include }));
  });

  it.each(['nfc', 'touch'] as const)('returns history relations for a %s replay after an idempotency uniqueness race', async (source) => {
    const { state, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const actor = { clientId: 'terminal-1' };
    const move = () => source === 'nfc'
      ? service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, idempotencyKey: 'race-key', actor })
      : service.processTouchTransaction({ compartmentId: 'compartment-1', quantity: 2, idempotencyKey: 'race-key', actor });
    const fresh = await move();
    db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }));

    const replay = await move();

    expect(replay.replayed).toBe(true);
    expect(replay.transaction.id).toBe(fresh.transaction.id);
    expect(replay.transaction.inventoryItem.name).toBe('治具');
    expect(replay.transaction.compartment?.drawer.shelf.shelfNumber).toBe(1);
    expect(state.compartment.stockQuantity).toBe(8);
    expect(state.transactions).toHaveLength(1);
  });

  it.each(['compartment-1', undefined])('accepts an expected matching compartment or the legacy input: %s', async (expectedCompartmentId) => {
    const { state, db } = inventoryState();
    const result = await new ItemInventoryService(db as never).processTransaction({
      itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, expectedCompartmentId,
    });
    expect(result.transaction).toMatchObject({ compartmentId: 'compartment-1', delta: -2, beforeQuantity: 10, afterQuantity: 8 });
    expect(state.compartment.stockQuantity).toBe(8);
    expect(state.transactions).toHaveLength(1);
  });

  it('rejects a reassigned item tag after locking without changing stock or creating a transaction', async () => {
    const { state, tx, db } = inventoryState();
    await expect(new ItemInventoryService(db as never).processTransaction({
      itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, expectedCompartmentId: 'displayed-compartment',
    })).rejects.toThrow(new InventoryConflictError('タグの登録が変わりました'));
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(state.compartment.stockQuantity).toBe(10);
    expect(state.transactions).toHaveLength(0);
  });

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

  it('uses the issue transaction time and preserves it on restock and correction', async () => {
    const { state, tx, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const issue = await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false });
    expect(state.compartment.lastIssuedAt).toEqual(issue.transaction.createdAt);
    expect(tx.inventoryCompartment.update).toHaveBeenCalledWith({ where: { id: 'compartment-1' }, data: { stockQuantity: 8, lastIssuedAt: issue.transaction.createdAt } });
    expect(issue.transaction.details).toEqual({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restockTagUid: null });
    await service.processTransaction({ itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restockTagUid: 'restock-uid', restock: true });
    await service.correctStock('compartment-1', 12, {});
    expect(state.compartment.lastIssuedAt).toEqual(issue.transaction.createdAt);
  });

  it('recomputes last issue on cancellation, excluding all cancelled issues', async () => {
    const { state, tx, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const input = { itemTagUid: 'item-uid', quantityTagUid: 'quantity-uid', restock: false, actor: { clientId: 'terminal-1' } };
    const first = await service.processTransaction(input);
    first.transaction.createdAt = new Date('2026-10-01T00:00:00Z');
    state.transactions[0].createdAt = first.transaction.createdAt;
    const second = await service.processTransaction(input);
    await service.cancelTransaction(second.transaction.id, input.actor);
    expect(state.compartment.lastIssuedAt).toEqual(first.transaction.createdAt);
    expect(tx.inventoryTransaction.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { compartmentId: 'compartment-1', action: 'ISSUE', id: { not: second.transaction.id }, reversedBy: { is: null } } }));
    const third = await service.processTransaction(input);
    await service.cancelTransaction(third.transaction.id, input.actor);
    expect(state.compartment.lastIssuedAt).toEqual(first.transaction.createdAt);
  });

  it('clears last issue when the only issue is cancelled and preserves it on restock cancellation', async () => {
    const { state, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const input = { compartmentId: 'compartment-1', quantity: 2, actor: { clientId: 'terminal-1' } };
    const issue = await service.processTouchTransaction(input);
    await service.cancelTransaction(issue.transaction.id, input.actor);
    expect(state.compartment.lastIssuedAt).toBeNull();
    const nextIssue = await service.processTouchTransaction(input);
    const restock = await service.processTouchTransaction({ ...input, restock: true });
    await service.cancelTransaction(restock.transaction.id, input.actor);
    expect(state.compartment.lastIssuedAt).toEqual(nextIssue.transaction.createdAt);
  });

  it('processes touch issue and restock without looking up tags and replays before balance checks', async () => {
    const { state, tx, db } = inventoryState();
    const service = new ItemInventoryService(db as never);
    const input = { compartmentId: 'compartment-1', quantity: 3, expectedBeforeQuantity: 10, idempotencyKey: 'touch-1', actor: { clientId: 'terminal-1' } };
    const issue = await service.processTouchTransaction(input);
    const replay = await service.processTouchTransaction(input);
    expect(issue).toMatchObject({ replayed: false, transaction: { action: 'ISSUE', quantityTagId: null, delta: -3, beforeQuantity: 10, afterQuantity: 7, details: { source: 'touch' } } });
    expect(state.compartment.lastIssuedAt).toEqual(issue.transaction.createdAt);
    expect(replay).toEqual({ transaction: issue.transaction, replayed: true });
    const restock = await service.processTouchTransaction({ compartmentId: input.compartmentId, quantity: 999999, restock: true });
    expect(restock.transaction).toMatchObject({ action: 'RESTOCK', delta: 999999, beforeQuantity: 7, afterQuantity: 1000006, details: { source: 'touch' } });
    expect(state.compartment.lastIssuedAt).toEqual(issue.transaction.createdAt);
    expect(tx.inventoryNfcTag.findUnique).not.toHaveBeenCalled();
    expect(state.transactions).toHaveLength(2);
  });

  it('rejects touch stock shortages and stale balances without mutation', async () => {
    const { tx, db } = inventoryState(1);
    const service = new ItemInventoryService(db as never);
    await expect(service.processTouchTransaction({ compartmentId: 'compartment-1', quantity: 2 })).rejects.toThrow('在庫が不足しています');
    await expect(service.processTouchTransaction({ compartmentId: 'compartment-1', quantity: 1, expectedBeforeQuantity: 0 })).rejects.toThrow('在庫が変わりました');
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 1000000])('rejects invalid touch quantity %s', async (quantity) => {
    const { tx, db } = inventoryState();
    await expect(new ItemInventoryService(db as never).processTouchTransaction({ compartmentId: 'compartment-1', quantity })).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
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

  it('corrects stock when the kiosk saw the current balance', async () => {
    const { state, db } = inventoryState(12);
    const service = new ItemInventoryService(db as never);

    const correction = await service.correctStock('compartment-1', 9, { clientId: 'terminal-1' }, undefined, { expectedBeforeQuantity: 12 });

    expect(correction).toMatchObject({ action: 'CORRECTION', delta: -3, beforeQuantity: 12, afterQuantity: 9, clientId: 'terminal-1' });
    expect(state.compartment.stockQuantity).toBe(9);
  });

  it('refuses a correction when stock changed after the kiosk showed it', async () => {
    const { state, tx, db } = inventoryState(10);
    const service = new ItemInventoryService(db as never);

    await expect(service.correctStock('compartment-1', 9, { clientId: 'terminal-1' }, undefined, { expectedBeforeQuantity: 12 }))
      .rejects.toThrow('在庫が変わりました');
    expect(state.compartment.stockQuantity).toBe(10);
    expect(tx.inventoryCompartment.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('corrects without a balance check when no expected balance is sent', async () => {
    const { state, db } = inventoryState(10);
    const service = new ItemInventoryService(db as never);

    await service.correctStock('compartment-1', 4, { clientId: null });

    expect(state.compartment.stockQuantity).toBe(4);
  });
});

describe('ItemInventoryService history', () => {
  it('filters history by compartment only when one is given', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ItemInventoryService({ inventoryTransaction: { findMany } } as never);

    await service.listHistory(3, { compartmentId: 'compartment-1' });
    await service.listHistory(100);

    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { compartmentId: 'compartment-1' }, take: 3, include: { inventoryItem: true, compartment: { include: { drawer: { include: { shelf: true } } } } } });
    expect(findMany.mock.calls[1][0].where).toBeUndefined();
  });
});

describe('ItemInventoryService pending import summaries', () => {
  it('returns pending candidates newest first with one thumbnail and the photo count', async () => {
    const createdAt = new Date('2026-09-30T05:45:05Z');
    const findMany = vi.fn().mockResolvedValue([
      { id: 'p5', sourceItemId: 5, area: '30042S_FJV50/80', category: '段取工具', createdAt, photos: [{ photoUrl: '/api/storage/photos/5.jpg' }], _count: { photos: 2 } },
      { id: 'p4', sourceItemId: 4, area: '50013_540AP', category: null, createdAt, photos: [], _count: { photos: 0 } },
    ]);
    const service = new ItemInventoryService({ inventoryImportPayload: { findMany } } as never);

    await expect(service.listPendingImportSummaries()).resolves.toEqual([
      { id: 'p5', sourceItemId: 5, area: '30042S_FJV50/80', category: '段取工具', createdAt, photoUrl: '/api/storage/photos/5.jpg', photoCount: 2 },
      { id: 'p4', sourceItemId: 4, area: '50013_540AP', category: null, createdAt, photoUrl: null, photoCount: 0 },
    ]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
  });
});

describe('inventory area normalization', () => {
  it('treats full-width and half-width spellings as one area', () => {
    expect(normalizeInventoryArea('30041R_2ＭＦ-Ｐ')).toBe('30041R_2MF-P');
    expect(normalizeInventoryArea('  ５００１３_５４０ＡＰ  ')).toBe('50013_540AP');
    expect(normalizeInventoryArea('A　 B')).toBe('A B');
    expect(normalizeInventoryArea('30007_KSJP-55')).toBe('30007_KSJP-55');
  });

  it('creates shelves under the normalized area', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'shelf-1' });
    const service = new ItemInventoryService({ inventoryShelf: { upsert } } as never);

    await service.createShelf('30041R_2ＭＦ-Ｐ', 1);

    expect(upsert).toHaveBeenCalledWith({
      where: { area_shelfNumber: { area: '30041R_2MF-P', shelfNumber: 1 } },
      create: { area: '30041R_2MF-P', shelfNumber: 1 },
      update: {},
    });
  });
});

describe('inventory units', () => {
  it('adds a unit under its normalized name and ignores a duplicate', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'unit-1', name: 'ケース' });
    const service = new ItemInventoryService({ inventoryUnit: { upsert } } as never);

    await service.createUnit(' ケース ');

    expect(upsert).toHaveBeenCalledWith({ where: { name: 'ケース' }, create: { name: 'ケース' }, update: {} });
    await expect(service.createUnit('   ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.createUnit('あ'.repeat(21))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('sets an item unit only to an offered unit, and null returns it to 個', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'item-1' });
    const db = {
      inventoryUnit: { findUnique: vi.fn(async ({ where }: { where: { name: string } }) => (where.name === 'ケース' ? { id: 'u', name: 'ケース' } : null)) },
      inventoryItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item-1', deletedAt: null }), update },
    };
    const service = new ItemInventoryService(db as never);

    await service.setItemUnit('item-1', 'ケース');
    await service.setItemUnit('item-1', null);

    expect(update).toHaveBeenNthCalledWith(1, { where: { id: 'item-1' }, data: { unit: 'ケース' } });
    expect(update).toHaveBeenNthCalledWith(2, { where: { id: 'item-1' }, data: { unit: null } });
    await expect(service.setItemUnit('item-1', '箱')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('inventory area rename', () => {
  function areaDb(targetClash: { shelfNumber: number } | null) {
    const tx = {
      inventoryShelf: {
        findMany: vi.fn().mockResolvedValue([{ shelfNumber: 1 }, { shelfNumber: 2 }]),
        findFirst: vi.fn().mockResolvedValue(targetClash),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    return { tx, db: { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) } };
  }

  it('renames every shelf of an area to the normalized new name', async () => {
    const { tx, db } = areaDb(null);
    const service = new ItemInventoryService(db as never);

    await expect(service.renameArea('30041R_2MF-P', '30041R_2ＭＦ-Ｐ 北')).resolves.toEqual({ renamed: 2, area: '30041R_2MF-P 北' });
    expect(tx.inventoryShelf.updateMany).toHaveBeenCalledWith({ where: { area: '30041R_2MF-P' }, data: { area: '30041R_2MF-P 北' } });
  });

  it('refuses when the new area already has a shelf with the same number', async () => {
    const { tx, db } = areaDb({ shelfNumber: 2 });
    const service = new ItemInventoryService(db as never);

    await expect(service.renameArea('A', 'B 北')).rejects.toThrow('同じ番号の棚');
    expect(tx.inventoryShelf.updateMany).not.toHaveBeenCalled();
  });
});

describe('inventory tool field options', () => {
  it('lists distinct used values per tool field', async () => {
    const findMany = vi.fn(async ({ select }: { select: Record<string, boolean> }) => {
      const field = Object.keys(select)[0];
      if (field === 'name') return [{ name: 'チップ' }, { name: 'ItemlistRaspi 12' }];
      return field === 'maker' ? [{ maker: 'OSG' }, { maker: '京セラ' }] : [];
    });
    const presets = vi.fn().mockResolvedValue([{ field: 'maker', value: 'イスカル' }, { field: 'maker', value: 'OSG' }, { field: 'usage', value: '上面' }]);
    const service = new ItemInventoryService({ inventoryItem: { findMany }, inventoryToolFieldPreset: { findMany: presets } } as never);

    await expect(service.listToolFieldOptions()).resolves.toEqual({
      name: ['チップ'], maker: ['OSG', 'イスカル', '京セラ'], toolName: [], workMaterial: [], toolSize: [], model: [], usage: ['上面'],
    });
    // 名前 is required, so only the optional fields ask for "not null".
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { deletedAt: null }, distinct: ['name'] });
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { deletedAt: null, maker: { not: null } }, distinct: ['maker'] });
  });
});

describe('inventory item list order data', () => {
  it('adds when each drawer was last issued', async () => {
    const db = {
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'item-1', itemCode: 'RI-1', name: 'A', model: null, usage: null, category: null, area: null, note: null, unit: null, photos: [],
          compartments: [
            { id: 'c-1', stockQuantity: 1, lastIssuedAt: null, drawer: { drawerNumber: 1, shelf: { area: 'X 北', shelfNumber: 1 } }, itemTag: null },
            { id: 'c-2', stockQuantity: 2, lastIssuedAt: new Date('2026-09-29T01:00:00Z'), drawer: { drawerNumber: 2, shelf: { area: 'X 北', shelfNumber: 1 } }, itemTag: null },
          ],
        }]),
      },
      inventoryTransaction: { groupBy: vi.fn().mockResolvedValue([{ compartmentId: 'c-2', _max: { createdAt: new Date('2026-09-29T01:00:00Z') } }]) },
    };
    const service = new ItemInventoryService(db as never);

    const [item] = await service.listItems();

    expect(item.compartments.map((compartment) => compartment.lastIssuedAt)).toEqual([null, '2026-09-29T01:00:00.000Z']);
    expect(db.inventoryTransaction.groupBy).not.toHaveBeenCalled();
  });
});

describe('inventory tool field values', () => {
  it('lists each choice with its item count in natural order, keeping unused presets', async () => {
    const groupBy = vi.fn(async ({ by }: { by: string[] }) => (by[0] === 'toolSize'
      ? [{ toolSize: 'φ100', _count: { _all: 2 } }, { toolSize: 'φ20', _count: { _all: 1 } }]
      : []));
    const presets = vi.fn().mockResolvedValue([{ field: 'toolSize', value: 'φ63' }, { field: 'toolSize', value: 'φ20' }]);
    const service = new ItemInventoryService({ inventoryItem: { groupBy }, inventoryToolFieldPreset: { findMany: presets } } as never);

    const values = await service.listToolFieldValues();

    expect(values.toolSize).toEqual([{ value: 'φ20', count: 1 }, { value: 'φ63', count: 0 }, { value: 'φ100', count: 2 }]);
    expect(values.maker).toEqual([]);
  });

  it('offers names as choices but leaves out provisional ones', async () => {
    const groupBy = vi.fn(async ({ by }: { by: string[] }) => (by[0] === 'name'
      ? [{ name: 'チップ', _count: { _all: 3 } }, { name: 'ItemlistRaspi 12', _count: { _all: 1 } }]
      : []));
    const service = new ItemInventoryService({ inventoryItem: { groupBy }, inventoryToolFieldPreset: { findMany: vi.fn().mockResolvedValue([]) } } as never);

    const values = await service.listToolFieldValues();

    expect(values.name).toEqual([{ value: 'チップ', count: 3 }]);
    // 名前 is required, so the query must not ask for "not null".
    expect(groupBy.mock.calls.find(([args]) => args.by[0] === 'name')![0]).toMatchObject({ where: { deletedAt: null } });
    expect(groupBy.mock.calls.find(([args]) => args.by[0] === 'name')![0].where).not.toHaveProperty('name');
  });

  it('changes only the given details of one item and never empties the name', async () => {
    const update = vi.fn(async ({ data }: { data: object }) => ({ id: 'item-1', ...data }));
    const findUnique = vi.fn().mockResolvedValue({ id: 'item-1', name: 'ItemlistRaspi 12', deletedAt: null });
    const service = new ItemInventoryService({ inventoryItem: { findUnique, update } } as never);

    await service.updateItemDetails('item-1', { name: ' ﾁｯﾌﾟ ', maker: '' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'item-1' }, data: { name: 'チップ', maker: null } });

    await expect(service.updateItemDetails('item-1', { name: '  ' })).rejects.toThrow('名前を入力してください');
    findUnique.mockResolvedValueOnce({ id: 'item-2', name: 'x', deletedAt: new Date() });
    await expect(service.updateItemDetails('item-2', { model: 'A' })).rejects.toThrow('アイテムが見つかりません');
  });

  it('renames the items and the preset together', async () => {
    const tx = {
      inventoryItem: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      inventoryToolFieldPreset: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn() },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    const service = new ItemInventoryService(db as never);

    await expect(service.renameToolFieldValue('maker', 'ミツビシ', ' ミツビシマテリアル ')).resolves.toEqual({ field: 'maker', value: 'ミツビシマテリアル', updatedItems: 3 });
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { deletedAt: null, maker: 'ミツビシ' }, data: { maker: 'ミツビシマテリアル' } });
    expect(tx.inventoryToolFieldPreset.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { field: 'maker', value: 'ミツビシマテリアル' } }));
  });

  it('refuses to delete a choice that items still use', async () => {
    const deleteMany = vi.fn();
    const service = new ItemInventoryService({ inventoryItem: { count: vi.fn().mockResolvedValue(2) }, inventoryToolFieldPreset: { deleteMany } } as never);

    await expect(service.deleteToolFieldValue('usage', '上面')).rejects.toThrow('2件');
    expect(deleteMany).not.toHaveBeenCalled();
  });
});


describe('inventory item list photo projection', () => {
  it('selects every photo column except sha256 and sourcePayloadId', async () => {
    const photo = { id: 'photo', inventoryItemId: 'item', photoUrl: '/photos/p.jpg', originalFilename: 'p.jpg', photoIndex: 1, createdAt: new Date() };
    const findMany = vi.fn().mockResolvedValue([{ id: 'item', photos: [photo], compartments: [] }]);
    const service = new ItemInventoryService({ inventoryItem: { findMany } } as never);
    const [item] = await service.listItems();
    expect(item.photos).toEqual([photo]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ photos: {
      orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, inventoryItemId: true, photoUrl: true, originalFilename: true, photoIndex: true, createdAt: true },
    } }) }));
  });
});

describe('ItemInventoryService setup deletion and candidate status', () => {
  function setupDb() {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      inventoryDrawer: { findUnique: vi.fn().mockResolvedValue({ id: 'd', _count: { compartments: 0 } }), delete: vi.fn() },
      inventoryShelf: { findUnique: vi.fn().mockResolvedValue({ id: 's', _count: { drawers: 0 } }), delete: vi.fn() },
      inventoryNfcTag: { findUnique: vi.fn().mockResolvedValue({ id: 't', kind: 'QUANTITY', compartmentId: null }), delete: vi.fn() },
      inventoryImportPayload: { findUnique: vi.fn().mockResolvedValue({ id: 'p' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = { $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)) };
    return { tx, service: new ItemInventoryService(db as never) };
  }

  it('deletes empty drawers and shelves only after locking and checking their children', async () => {
    const { tx, service } = setupDb();
    await expect(service.deleteDrawer('d')).resolves.toEqual({ id: 'd' });
    await expect(service.deleteShelf('s')).resolves.toEqual({ id: 's' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.inventoryDrawer.findUnique).toHaveBeenCalledWith({ where: { id: 'd' }, include: { _count: { select: { compartments: true } } } });
    expect(tx.inventoryShelf.findUnique).toHaveBeenCalledWith({ where: { id: 's' }, include: { _count: { select: { drawers: true } } } });
    expect(tx.inventoryDrawer.delete).toHaveBeenCalledWith({ where: { id: 'd' } });
    expect(tx.inventoryShelf.delete).toHaveBeenCalledWith({ where: { id: 's' } });
  });

  it('refuses nonempty drawers and shelves without deleting anything', async () => {
    const { tx, service } = setupDb();
    tx.inventoryDrawer.findUnique.mockResolvedValue({ id: 'd', _count: { compartments: 1 } });
    tx.inventoryShelf.findUnique.mockResolvedValue({ id: 's', _count: { drawers: 1 } });
    await expect(service.deleteDrawer('d')).rejects.toThrow('品物が入っている');
    await expect(service.deleteShelf('s')).rejects.toThrow('引き出しがある');
    expect(tx.inventoryDrawer.delete).not.toHaveBeenCalled();
    expect(tx.inventoryShelf.delete).not.toHaveBeenCalled();
  });

  it.each(['QUANTITY', 'RESTOCK'])('deletes a %s tag', async (kind) => {
    const { tx, service } = setupDb();
    tx.inventoryNfcTag.findUnique.mockResolvedValue({ id: 't', kind, compartmentId: null });
    await expect(service.deleteTag('t')).resolves.toEqual({ id: 't' });
    expect(tx.inventoryNfcTag.delete).toHaveBeenCalledWith({ where: { id: 't' } });
  });

  it('refuses even an unbound ITEM tag', async () => {
    const { tx, service } = setupDb();
    tx.inventoryNfcTag.findUnique.mockResolvedValue({ id: 't', kind: 'ITEM', compartmentId: null });
    await expect(service.deleteTag('t')).rejects.toThrow('タグ交換');
    expect(tx.inventoryNfcTag.delete).not.toHaveBeenCalled();
  });

  it('returns 404 for missing setup targets', async () => {
    const { tx, service } = setupDb();
    tx.inventoryDrawer.findUnique.mockResolvedValue(null as never);
    tx.inventoryShelf.findUnique.mockResolvedValue(null as never);
    tx.inventoryNfcTag.findUnique.mockResolvedValue(null as never);
    tx.inventoryImportPayload.findUnique.mockResolvedValue(null as never);
    for (const result of [service.deleteDrawer('d'), service.deleteShelf('s'), service.deleteTag('t'), service.dismissImport('p'), service.restoreImport('p')]) {
      await expect(result).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it('dismisses and restores only the expected current status', async () => {
    let status = 'PENDING';
    const { tx, service } = setupDb();
    tx.inventoryImportPayload.updateMany.mockImplementation(async (input: any) => {
      if (input.where.status !== status) return { count: 0 };
      status = input.data.status;
      return { count: 1 };
    });
    await expect(service.dismissImport('p')).resolves.toEqual({ id: 'p', status: 'DISMISSED' });
    await expect(service.dismissImport('p')).rejects.toThrow('状態が変わっています');
    await expect(service.restoreImport('p')).resolves.toEqual({ id: 'p', status: 'PENDING' });
    await expect(service.restoreImport('p')).rejects.toThrow('状態が変わっています');
    status = 'REGISTERED';
    await expect(service.dismissImport('p')).rejects.toThrow('状態が変わっています');
    await expect(service.restoreImport('p')).rejects.toThrow('状態が変わっています');
  });

  it('keeps dismissed candidates out of both pending lists', async () => {
    const candidates = [
      { id: 'p', status: 'PENDING', photos: [], _count: { photos: 0 } },
      { id: 'd', status: 'DISMISSED', photos: [], _count: { photos: 0 } },
    ];
    const findMany = vi.fn(async ({ where }: { where: { status: string } }) => candidates.filter((candidate) => candidate.status === where.status));
    const service = new ItemInventoryService({ inventoryImportPayload: { findMany } } as never);
    expect((await service.listPendingImports()).map((candidate) => candidate.id)).toEqual(['p']);
    expect((await service.listPendingImportSummaries()).map((candidate) => candidate.id)).toEqual(['p']);
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const [args] of findMany.mock.calls) expect(args.where).toEqual({ status: 'PENDING' });
  });
});
