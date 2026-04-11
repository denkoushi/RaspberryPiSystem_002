import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireClientDevice } from '../kiosk/shared.js';
import { resolveCredentialIdentity } from '../../lib/location-scope-resolver.js';
import { registerMobilePlacementScheduleRoute } from './schedule-list.js';
import { registerPlacement, resolveItemByBarcode } from '../../services/mobile-placement/mobile-placement.service.js';
import { registerOrderPlacement } from '../../services/mobile-placement/mobile-placement-order-placement.service.js';
import { listRegisteredShelvesFromOrderPlacements } from '../../services/mobile-placement/mobile-placement-registered-shelves.service.js';
import { verifySlipMatch } from '../../services/mobile-placement/mobile-placement-verify-slip.service.js';

const registerBodySchema = z.object({
  shelfCodeRaw: z.string().min(1),
  itemBarcodeRaw: z.string().min(1),
  csvDashboardRowId: z.string().min(1).optional().nullable()
});

const verifySlipMatchBodySchema = z.object({
  transferOrderBarcodeRaw: z.string().min(1),
  transferFhinmeiBarcodeRaw: z.string().min(1),
  actualOrderBarcodeRaw: z.string().min(1),
  actualFhinmeiBarcodeRaw: z.string().min(1)
});

const registerOrderPlacementBodySchema = z.object({
  shelfCodeRaw: z.string().min(1),
  manufacturingOrderBarcodeRaw: z.string().min(1)
});

export async function registerMobilePlacementRoutes(app: FastifyInstance): Promise<void> {
  const kioskDeps = {
    requireClientDevice
  };

  await registerMobilePlacementScheduleRoute(app, kioskDeps);

  /**
   * 登録済み棚番候補（`OrderPlacementEvent.shelfCodeRaw` の distinct + 構造化メタ）
   */
  app.get('/mobile-placement/registered-shelves', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const shelves = await listRegisteredShelvesFromOrderPlacements();
    return { shelves };
  });

  app.get('/mobile-placement/resolve-item', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = request.query as { barcode?: string };
    const barcode = typeof q.barcode === 'string' ? q.barcode : '';
    const result = await resolveItemByBarcode(barcode);
    return result;
  });

  app.post('/mobile-placement/verify-slip-match', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const body = verifySlipMatchBodySchema.parse(request.body);
    const result = await verifySlipMatch(body);
    if (result.ok) {
      return { ok: true as const };
    }
    return { ok: false as const, reason: result.reason };
  });

  app.post('/mobile-placement/register-order-placement', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerOrderPlacementBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerOrderPlacement({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw
    });
    return {
      event: {
        id: result.event.id,
        clientDeviceId: result.event.clientDeviceId,
        shelfCodeRaw: result.event.shelfCodeRaw,
        manufacturingOrderBarcodeRaw: result.event.manufacturingOrderBarcodeRaw,
        csvDashboardRowId: result.event.csvDashboardRowId,
        placedAt: result.event.placedAt
      },
      resolvedRowId: result.resolvedRowId
    };
  });

  app.post('/mobile-placement/register', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await requireClientDevice(request.headers['x-client-key']);
    const body = registerBodySchema.parse(request.body);
    const identity = resolveCredentialIdentity(clientDevice);
    const result = await registerPlacement({
      clientDeviceId: identity.clientDeviceId,
      shelfCodeRaw: body.shelfCodeRaw,
      itemBarcodeRaw: body.itemBarcodeRaw,
      csvDashboardRowId: body.csvDashboardRowId ?? undefined
    });
    return {
      event: {
        id: result.event.id,
        clientDeviceId: result.event.clientDeviceId,
        shelfCodeRaw: result.event.shelfCodeRaw,
        itemBarcodeRaw: result.event.itemBarcodeRaw,
        itemId: result.event.itemId,
        csvDashboardRowId: result.event.csvDashboardRowId,
        previousStorageLocation: result.event.previousStorageLocation,
        newStorageLocation: result.event.newStorageLocation,
        placedAt: result.event.placedAt
      },
      item: result.item,
      resolveMatchKind: result.resolveMatchKind
    };
  });
}
