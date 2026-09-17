import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);
const originalDatabaseUrl = process.env.DATABASE_URL;

type PrismaClient = import('@prisma/client').PrismaClient;
type ItemInventoryServiceInstance = import('../item-inventory.service.js').ItemInventoryService;
type ItemInventoryServiceConstructor = typeof import('../item-inventory.service.js').ItemInventoryService;
let dbClient: PrismaClient | undefined;
let ItemInventoryServiceConstructor: ItemInventoryServiceConstructor | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  ({ ItemInventoryService: ItemInventoryServiceConstructor } = await import('../item-inventory.service.js'));
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

function service(): ItemInventoryServiceInstance {
  if (!ItemInventoryServiceConstructor) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return new ItemInventoryServiceConstructor(db());
}

describeIntegration('item inventory registration concurrency', () => {
  afterAll(async () => {
    await dbClient?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('registers one item when two transactions claim the same candidate concurrently', async () => {
    const database = db();
    const sourceItemId = 900000 + Math.floor(Math.random() * 9999);
    const suffix = randomUUID();
    const itemTagUids = [`inventory-concurrency-${suffix}-a`, `inventory-concurrency-${suffix}-b`];
    const shelf = await database.inventoryShelf.create({ data: { area: `TEST-${suffix}`, shelfNumber: 1 } });
    const drawer = await database.inventoryDrawer.create({ data: { shelfId: shelf.id, drawerNumber: 1 } });
    const payload = await database.inventoryImportPayload.create({
      data: {
        contentHash: randomUUID().replaceAll('-', ''),
        sourceSystem: 'integration-test',
        sourceList: 'integration-test',
        sourceItemId,
        sourceModified: new Date(),
        area: shelf.area,
        manifest: {},
      },
    });

    try {
      const results = await Promise.allSettled(itemTagUids.map((itemTagUid) => service().registerImport({
        payloadId: payload.id,
        mode: 'NEW_ITEM',
        name: '同時登録テスト',
        shelfId: shelf.id,
        drawerId: drawer.id,
        itemTagUid,
        initialQuantity: 7,
      })));

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ statusCode: 409 });

      const registeredPayload = await database.inventoryImportPayload.findUniqueOrThrow({ where: { id: payload.id } });
      if (!registeredPayload.registeredItemId) throw new Error('Concurrent registration did not record a registered item');
      const registeredItemId = registeredPayload.registeredItemId;
      const items = await database.inventoryItem.findMany({ where: { id: registeredItemId } });
      const compartments = await database.inventoryCompartment.findMany({ where: { inventoryItemId: registeredItemId } });
      const transactions = await database.inventoryTransaction.findMany({ where: { inventoryItemId: registeredItemId, action: 'REGISTER' } });
      expect(items).toHaveLength(1);
      expect(compartments).toHaveLength(1);
      expect(compartments[0]?.stockQuantity).toBe(7);
      expect(transactions).toHaveLength(1);
    } finally {
      const registered = await database.inventoryImportPayload.findUnique({ where: { id: payload.id }, select: { registeredItemId: true } });
      if (registered?.registeredItemId) {
        await database.inventoryTransaction.deleteMany({ where: { inventoryItemId: registered.registeredItemId } });
        await database.inventoryNfcTag.deleteMany({ where: { uid: { in: itemTagUids } } });
        await database.inventoryCompartment.deleteMany({ where: { inventoryItemId: registered.registeredItemId } });
        await database.inventoryItem.delete({ where: { id: registered.registeredItemId } });
      }
      await database.inventoryImportPayload.delete({ where: { id: payload.id } });
      await database.inventoryDrawer.delete({ where: { id: drawer.id } });
      await database.inventoryShelf.delete({ where: { id: shelf.id } });
    }
  });
});
