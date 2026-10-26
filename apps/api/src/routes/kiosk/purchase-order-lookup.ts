import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { queryPurchaseOrderLookup } from '../../services/purchase-order-lookup/purchase-order-lookup-query.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const purchaseOrderNoParamsSchema = z.object({
  purchaseOrderNo: z.string().regex(/^\d{10}$/),
});

export async function registerPurchaseOrderLookupRoute(
  app: FastifyInstance,
  deps: Pick<KioskRouteDeps, 'requireClientDevice'>
): Promise<void> {
  app.get(
    '/kiosk/purchase-order-lookup/:purchaseOrderNo',
    { config: { rateLimit: false } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const params = purchaseOrderNoParamsSchema.parse(request.params);
      return queryPurchaseOrderLookup(params.purchaseOrderNo);
    }
  );
}
