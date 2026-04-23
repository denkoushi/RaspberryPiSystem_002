import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  commandAddPalletItem,
  commandClearPallet,
  commandDeletePalletItem,
  commandReplacePalletItem,
} from '../../services/pallet-visualization/pallet-visualization-command.service.js';
import {
  queryPalletVisualizationMachine,
  queryPalletVisualizationMachines,
  queryPalletVisualizationBoard,
  queryPalletVisualizationHistory,
} from '../../services/pallet-visualization/pallet-visualization-query.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';
import { ApiError } from '../../lib/errors.js';

function requireDeviceId(clientDevice: { id?: string }): string {
  const id = clientDevice.id;
  if (!id) {
    throw new ApiError(401, '端末IDを解決できません', undefined, 'CLIENT_DEVICE_ID_MISSING');
  }
  return id;
}

const addItemBodySchema = z.object({
  machineCd: z.string().min(1),
  palletNo: z.number().int().min(1),
  manufacturingOrderBarcodeRaw: z.string().min(1),
});

const replaceBodySchema = z.object({
  manufacturingOrderBarcodeRaw: z.string().min(1),
});

const clearParamsSchema = z.object({
  machineCd: z.string().min(1),
  palletNo: z.coerce.number().int().min(1),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().uuid().optional(),
});

const machineCdParamsSchema = z.object({
  machineCd: z.string().min(1),
});

export async function registerKioskPalletVisualizationRoutes(
  app: FastifyInstance,
  deps: Pick<KioskRouteDeps, 'requireClientDevice'>
): Promise<void> {
  app.get('/kiosk/pallet-visualization/board', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    void clientDevice;
    return queryPalletVisualizationBoard();
  });

  app.get('/kiosk/pallet-visualization/machines', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    void clientDevice;
    return queryPalletVisualizationMachines();
  });

  app.get('/kiosk/pallet-visualization/machines/:machineCd', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    void clientDevice;
    const params = machineCdParamsSchema.parse(request.params);
    return queryPalletVisualizationMachine(params.machineCd);
  });

  app.get('/kiosk/pallet-visualization/history', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    void clientDevice;
    const q = historyQuerySchema.parse(request.query);
    return queryPalletVisualizationHistory({ limit: q.limit ?? 50, cursor: q.cursor });
  });

  app.post('/kiosk/pallet-visualization/items', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const body = addItemBodySchema.parse(request.body);
    return commandAddPalletItem({
      clientDeviceId: requireDeviceId(clientDevice),
      machineCd: body.machineCd,
      palletNo: body.palletNo,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw,
    });
  });

  app.post('/kiosk/pallet-visualization/items/:id/replace', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = replaceBodySchema.parse(request.body);
    return commandReplacePalletItem({
      clientDeviceId: requireDeviceId(clientDevice),
      itemId: id,
      manufacturingOrderBarcodeRaw: body.manufacturingOrderBarcodeRaw,
    });
  });

  app.delete('/kiosk/pallet-visualization/items/:id', { config: { rateLimit: false } }, async (request, reply) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await commandDeletePalletItem({ clientDeviceId: requireDeviceId(clientDevice), itemId: id });
    return reply.status(204).send();
  });

  app.post(
    '/kiosk/pallet-visualization/machines/:machineCd/pallets/:palletNo/clear',
    { config: { rateLimit: false } },
    async (request, reply) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const params = clearParamsSchema.parse(request.params);
      await commandClearPallet({
        clientDeviceId: requireDeviceId(clientDevice),
        machineCd: params.machineCd,
        palletNo: params.palletNo,
      });
      return reply.status(204).send();
    }
  );
}
