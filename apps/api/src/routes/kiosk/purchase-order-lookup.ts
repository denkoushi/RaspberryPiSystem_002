import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { queryPurchaseOrderLookup } from '../../services/purchase-order-lookup/purchase-order-lookup-query.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../lib/terminal-route-rate-limit.js';

const purchaseOrderNoParamsSchema = z.object({
  purchaseOrderNo: z.string().regex(/^\d{10}$/),
});

export async function registerPurchaseOrderLookupRoute(
  app: FastifyInstance,
  deps: Pick<KioskRouteDeps, 'requireClientDevice'>
): Promise<void> {
  app.get(
    '/kiosk/purchase-order-lookup/:purchaseOrderNo',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const params = purchaseOrderNoParamsSchema.parse(request.params);
      return queryPurchaseOrderLookup(params.purchaseOrderNo);
    }
  );
}
