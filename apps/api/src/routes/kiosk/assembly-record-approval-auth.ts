import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AssemblyProcedureOrderService } from '../../services/assembly/assembly-procedure-order.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const assemblyRecordApprovalAccessPasswordVerifyBodySchema = z.object({
  password: z.string().min(1).max(128)
});

const assemblyRecordApprovalAccessPasswordRateLimit = { max: 10, timeWindow: '1 minute' };

export async function registerKioskAssemblyRecordApprovalAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const service = new AssemblyProcedureOrderService();
  app.post(
    '/kiosk/assembly/record-approvals/verify-access-password',
    { config: { rateLimit: assemblyRecordApprovalAccessPasswordRateLimit } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = assemblyRecordApprovalAccessPasswordVerifyBodySchema.parse(request.body);
      return service.verifyAccessPassword(body.password);
    }
  );
}
