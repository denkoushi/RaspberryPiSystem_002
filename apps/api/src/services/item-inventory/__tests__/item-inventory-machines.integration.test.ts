import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

// Match the existing inventory integration tests: never use the default database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try { return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? ''; }
  catch { return ''; }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);
const originalDatabaseUrl = process.env.DATABASE_URL;
let database: import('@prisma/client').PrismaClient | undefined;
if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: database } = await import('../../../lib/prisma.js'));
}

(hasDedicatedDatabase ? describe : describe.skip)('inventory machine foreign keys', () => {
  afterAll(async () => {
    await database?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('allows unrelated site deletion and retains transactions when machines are deleted', async () => {
    if (!database) throw new Error('Dedicated TEST_DATABASE_URL is required');
    const db = database;
    const suffix = randomUUID();
    const siteKey = `machine-${suffix}`;
    const machineId = randomUUID();
    const deviceId = randomUUID();
    const itemId = randomUUID();
    const transactionId = randomUUID();
    try {
      await db.site.create({ data: { key: siteKey, displayName: siteKey } });
      await db.machine.create({ data: { id: machineId, equipmentManagementNumber: suffix, name: '旋盤' } });
      await db.site.delete({ where: { key: siteKey } });
      await db.site.create({ data: { key: siteKey, displayName: siteKey } });
      await db.clientDevice.create({ data: { id: deviceId, name: 'test', apiKey: suffix, siteKey } });
      await db.machineNfcTag.create({ data: { machineId, uid: suffix } });
      await db.kioskInventoryMachineOrder.create({ data: { clientDeviceId: deviceId, machineId, position: 0 } });
      await db.inventoryItem.create({ data: { id: itemId, itemCode: suffix, name: 'test' } });
      await db.inventoryTransaction.create({ data: { id: transactionId, inventoryItemId: itemId, machineId, action: 'ISSUE', delta: -1, beforeQuantity: 2, afterQuantity: 1 } });
      await db.machine.delete({ where: { id: machineId } });
      expect(await db.inventoryTransaction.findUnique({ where: { id: transactionId } })).toMatchObject({ machineId: null, delta: -1 });
      expect(await db.machineNfcTag.count({ where: { machineId } })).toBe(0);
      expect(await db.kioskInventoryMachineOrder.count({ where: { machineId } })).toBe(0);
    } finally {
      await db.inventoryTransaction.deleteMany({ where: { id: transactionId } });
      await db.inventoryItem.deleteMany({ where: { id: itemId } });
      await db.machine.deleteMany({ where: { id: machineId } });
      await db.clientDevice.deleteMany({ where: { id: deviceId } });
      await db.site.deleteMany({ where: { key: siteKey } });
    }
  });
});
