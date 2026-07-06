import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AssemblyProcedureOrderService } from '../../services/assembly/assembly-procedure-order.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const assemblyProcedureOrderAccessPasswordVerifyBodySchema = z.object({
  password: z.string().min(1).max(128)
});

const assemblyProcedureOrderAccessPasswordRateLimit = { max: 10, timeWindow: '1 minute' };

export async function registerKioskAssemblyProcedureOrderAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const service = new AssemblyProcedureOrderService();
  app.post(
    '/kiosk/assembly/procedure-order-settings/verify-access-password',
    { config: { rateLimit: assemblyProcedureOrderAccessPasswordRateLimit } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = assemblyProcedureOrderAccessPasswordVerifyBodySchema.parse(request.body);
      return service.verifyAccessPassword(body.password);
    }
  );
}
