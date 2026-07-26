import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AssemblyTemplateAccessService } from '../../services/assembly/assembly-template-access.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const bodySchema = z.object({
  password: z.string().min(1).max(128)
});

const rateLimit = { max: 10, timeWindow: '1 minute' };

export async function registerKioskAssemblyTemplateAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  const service = new AssemblyTemplateAccessService();
  app.post(
    '/kiosk/assembly/templates/verify-access-password',
    { config: { rateLimit } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = bodySchema.parse(request.body);
      return service.verifyAccessPassword(body.password);
    }
  );
}
