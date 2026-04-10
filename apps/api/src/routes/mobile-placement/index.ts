import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireClientDevice } from '../kiosk/shared.js';
import { resolveCredentialIdentity } from '../../lib/location-scope-resolver.js';
import { registerMobilePlacementScheduleRoute } from './schedule-list.js';
import { registerPlacement, resolveItemByBarcode } from '../../services/mobile-placement/mobile-placement.service.js';

const registerBodySchema = z.object({
  shelfCodeRaw: z.string().min(1),
  itemBarcodeRaw: z.string().min(1),
  csvDashboardRowId: z.string().min(1).optional().nullable()
});

export async function registerMobilePlacementRoutes(app: FastifyInstance): Promise<void> {
  const kioskDeps = {
    requireClientDevice
  };

  await registerMobilePlacementScheduleRoute(app, kioskDeps);

  app.get('/mobile-placement/resolve-item', { config: { rateLimit: false } }, async (request) => {
    await requireClientDevice(request.headers['x-client-key']);
    const q = request.query as { barcode?: string };
    const barcode = typeof q.barcode === 'string' ? q.barcode : '';
    const result = await resolveItemByBarcode(barcode);
    return result;
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
