import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import { ApiError } from '../../lib/errors.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { getItemInventoryServices } from '../../services/item-inventory/item-inventory-service.factory.js';
import { InventoryConflictError, InventoryInsufficientStockError } from '../../services/item-inventory/item-inventory.service.js';

const uidQuery = z.object({ uid: z.string().trim().min(1).max(256) });
const idParams = z.object({ id: z.string().uuid() });
const compartmentParams = z.object({ id: z.string().uuid() });
const manage = authorizeRoles('ADMIN', 'MANAGER');
const read = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
};

const adminAuthorizedRequests = new WeakSet<FastifyRequest>();

async function writeOrKiosk(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.headers.authorization) {
    try {
      await manage(request, reply);
      adminAuthorizedRequests.add(request);
      return;
    } catch (error) {
      if (!request.headers['x-client-key']) throw error;
    }
  }
  await requireClientDevice(request.headers['x-client-key']);
}

async function cancelWrite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await writeOrKiosk(request, reply);
}

async function actor(request: FastifyRequest) {
  const raw = request.headers['x-client-key'];
  const key = typeof raw === 'string' ? raw : raw?.[0];
  const device = key ? await requireClientDevice(key) : null;
  return { clientId: device?.clientDevice.id ?? null, performedByUserId: request.user?.id ?? null };
}

function mapMutationError(error: unknown): never {
  if (error instanceof InventoryInsufficientStockError) throw new ApiError(409, error.message, undefined, 'INVENTORY_INSUFFICIENT_STOCK');
  if (error instanceof InventoryConflictError) throw new ApiError(409, error.message, undefined, 'INVENTORY_CONFLICT');
  throw error;
}

const registerBody = z.object({
  mode: z.enum(['NEW_ITEM', 'EXISTING_ITEM']),
  itemId: z.string().uuid().optional(),
  name: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  usage: z.string().max(500).optional(),
  shelfId: z.string().uuid().optional(),
  drawerId: z.string().uuid().optional(),
  itemTagUid: z.string().max(256).optional(),
  initialQuantity: z.number().int().min(0).optional(),
  reviewNote: z.string().max(1000).optional(),
});

const transactionBody = z.object({
  itemTagUid: z.string().trim().min(1).max(256),
  quantityTagUid: z.string().trim().min(1).max(256),
  restockTagUid: z.string().trim().min(1).max(256).optional(),
  restock: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export function registerItemInventoryRoutes(app: FastifyInstance): void {
  const services = getItemInventoryServices();

  app.get('/item-inventory/tags/resolve', { preHandler: [read] }, async (request) => {
    const query = uidQuery.parse(request.query ?? {});
    return { tag: await services.inventory.resolveTag(query.uid) };
  });

  app.get('/item-inventory/tags', { preHandler: [read] }, async () => ({ tags: await services.inventory.listTags() }));
  app.get('/item-inventory/locations', { preHandler: [read] }, async () => ({ locations: await services.inventory.listLocations() }));
  app.get('/item-inventory/items', { preHandler: [read] }, async () => ({ items: await services.inventory.listItems() }));
  app.get('/item-inventory/history', { preHandler: [read] }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query ?? {});
    return { history: await services.inventory.listHistory(query.limit) };
  });
  app.get('/item-inventory/imports', { preHandler: [manage] }, async () => ({ imports: await services.inventory.listPendingImports() }));
  app.get('/item-inventory/import-messages', { preHandler: [manage] }, async () => ({ messages: await services.inventory.listImportMessages() }));

  app.post('/item-inventory/transactions', { preHandler: [writeOrKiosk] }, async (request) => {
    const body = transactionBody.parse(request.body ?? {});
    try {
      const result = await services.inventory.processTransaction({ ...body, actor: await actor(request) });
      return { ...result, transaction: { ...result.transaction, createdAt: result.transaction.createdAt.toISOString() } };
    } catch (error) {
      mapMutationError(error);
    }
  });

  app.post('/item-inventory/transactions/:id/cancel', { preHandler: [cancelWrite] }, async (request) => {
    const { id } = idParams.parse(request.params);
    try {
      const transaction = await services.inventory.cancelTransaction(id, await actor(request), { allowAnyClient: adminAuthorizedRequests.has(request) });
      return { transaction: { ...transaction, createdAt: transaction.createdAt.toISOString() } };
    } catch (error) {
      mapMutationError(error);
    }
  });

  app.post('/item-inventory/corrections', { preHandler: [manage] }, async (request) => {
    const body = z.object({ compartmentId: z.string().uuid(), desiredQuantity: z.number().int().min(0), note: z.string().max(1000).optional() }).parse(request.body ?? {});
    try {
      const transaction = await services.inventory.correctStock(body.compartmentId, body.desiredQuantity, await actor(request), body.note);
      return { transaction: { ...transaction, createdAt: transaction.createdAt.toISOString() } };
    } catch (error) {
      mapMutationError(error);
    }
  });

  app.post('/item-inventory/locations/shelves', { preHandler: [manage] }, async (request) => {
    const body = z.object({ area: z.string().trim().min(1).max(200), shelfNumber: z.number().int().min(1) }).parse(request.body ?? {});
    return { shelf: await services.inventory.createShelf(body.area, body.shelfNumber) };
  });
  app.post('/item-inventory/locations/drawers', { preHandler: [manage] }, async (request) => {
    const body = z.object({ shelfId: z.string().uuid(), drawerNumber: z.number().int().min(1) }).parse(request.body ?? {});
    return { drawer: await services.inventory.createDrawer(body.shelfId, body.drawerNumber) };
  });
  app.post('/item-inventory/tags/quantity', { preHandler: [manage] }, async (request) => {
    const body = z.object({ uid: z.string().trim().min(1).max(256), quantity: z.number().int().min(1) }).parse(request.body ?? {});
    return { tag: await services.inventory.upsertQuantityTag(body.uid, body.quantity) };
  });
  app.post('/item-inventory/tags/restock', { preHandler: [manage] }, async (request) => {
    const body = z.object({ uid: z.string().trim().min(1).max(256) }).parse(request.body ?? {});
    return { tag: await services.inventory.upsertRestockTag(body.uid) };
  });

  app.post('/item-inventory/imports/:id/register', { preHandler: [manage] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = registerBody.parse(request.body ?? {});
    return { result: await services.inventory.registerImport({ ...body, payloadId: id, actor: await actor(request) }) };
  });

  app.post('/item-inventory/compartments', { preHandler: [manage] }, async (request) => {
    const body = z.object({
      itemId: z.string().uuid(),
      shelfId: z.string().uuid(),
      drawerId: z.string().uuid(),
      itemTagUid: z.string().trim().min(1).max(256),
      initialQuantity: z.number().int().min(0),
    }).parse(request.body ?? {});
    return { result: await services.inventory.bindCompartment({ ...body, actor: await actor(request) }) };
  });

  app.post('/item-inventory/import-messages/:id/retry', { preHandler: [manage] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const config = await BackupConfigLoader.load();
    const result = await services.ingestion.retryRecord(id, { config, allowWait: true });
    return { result };
  });

  app.put('/item-inventory/compartments/:id/location', { preHandler: [manage] }, async (request) => {
    const { id } = compartmentParams.parse(request.params);
    const body = z.object({ drawerId: z.string().uuid() }).parse(request.body ?? {});
    return { transaction: await services.inventory.moveLocation(id, body.drawerId, await actor(request)) };
  });
  app.put('/item-inventory/compartments/:id/tag', { preHandler: [manage] }, async (request) => {
    const { id } = compartmentParams.parse(request.params);
    const body = z.object({ uid: z.string().trim().min(1).max(256) }).parse(request.body ?? {});
    return { tag: await services.inventory.replaceItemTag(id, body.uid, await actor(request)) };
  });

  app.post('/item-inventory/ingest', { preHandler: [manage] }, async (request, reply) => {
    const body = z.object({ messageId: z.string().trim().min(1).optional() }).default({}).parse(request.body ?? {});
    const config = await BackupConfigLoader.load();
    const result = await services.ingestion.runOnce({ config, allowWait: true, manual: true, messageId: body.messageId });
    return reply.code(202).send({ result });
  });
}
