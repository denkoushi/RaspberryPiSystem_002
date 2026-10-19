import { KIOSK_INITIAL_ROUTE_IDS, resolveKioskInitialPath } from '@raspi-system/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../../lib/prisma.js';

const initialRouteBodySchema = z.object({
  initialRoute: z.enum(KIOSK_INITIAL_ROUTE_IDS).nullable()
}).strict();

type InitialRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{ clientDevice: { id: string } }>;
};

export async function registerKioskInitialRoute(app: FastifyInstance, deps: InitialRouteDeps): Promise<void> {
  app.put('/kiosk/initial-route', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { initialRoute } = initialRouteBodySchema.parse(request.body);
    const updated = await prisma.clientDevice.update({
      where: { id: clientDevice.id },
      data: { kioskInitialRoute: initialRoute },
      select: { defaultMode: true }
    });
    return {
      ok: true,
      initialKioskRoute: initialRoute,
      initialKioskPath: resolveKioskInitialPath({ initialRoute, defaultMode: updated.defaultMode })
    };
  });
}
