import type { FastifyInstance } from 'fastify';

import { resolveSeibanMachineDisplayNames } from '../../../services/production-schedule/seiban-machine-display-names.service.js';
import { productionScheduleSeibanMachineNamesBodySchema, type KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleSeibanMachineNamesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.post(
    '/kiosk/production-schedule/seiban-machine-names',
    { config: { rateLimit: false } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = productionScheduleSeibanMachineNamesBodySchema.parse(request.body ?? {});
      return resolveSeibanMachineDisplayNames(body.fseibans);
    }
  );
}
