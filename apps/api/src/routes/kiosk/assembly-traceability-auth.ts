import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AssemblyTraceabilityAccessService } from '../../services/assembly/assembly-traceability-access.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const bodySchema = z.object({ password: z.string().min(1).max(128) });
const rateLimit = { max: 10, timeWindow: '1 minute' };

/** UIのロック解除確認用。変更API自体も同じパスワードを必ず再検証する。 */
export async function registerKioskAssemblyTraceabilityAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const service = new AssemblyTraceabilityAccessService();
  app.post(
    '/kiosk/assembly/traceability/verify-access-password',
    { config: { rateLimit } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = bodySchema.parse(request.body);
      return service.verifyAccessPassword(body.password);
    }
  );
}
