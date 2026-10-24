import { KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';

import { prisma } from '../../lib/prisma.js';

const portalCardsBodySchema = z.object({
  hiddenTabIds: z.array(z.enum(KIOSK_REORDERABLE_HEADER_TAB_IDS)).transform((ids) => [...new Set(ids)])
}).strict();

type PortalCardsDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<{ clientDevice: { id: string } }>;
};

export async function registerKioskPortalCardsRoute(app: FastifyInstance, deps: PortalCardsDeps): Promise<void> {
  app.put('/kiosk/portal-cards', { config: { rateLimit: false } }, async (request) => {
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    const { hiddenTabIds } = portalCardsBodySchema.parse(request.body);
    await prisma.clientDevice.update({
      where: { id: clientDevice.id },
      data: { kioskPortalHiddenTabIds: hiddenTabIds },
      select: { id: true }
    });
    return { ok: true, portalHiddenTabIds: hiddenTabIds };
  });
}
