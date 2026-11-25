import type { FastifyInstance } from 'fastify';

import { resolveSeibanMachineDisplayNamesBatched } from '../../../services/production-schedule/seiban-machine-display-names.service.js';
import { productionScheduleSeibanMachineNamesBodySchema, type KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleSeibanMachineNamesRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.post(
    '/kiosk/production-schedule/seiban-machine-names',
    { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = productionScheduleSeibanMachineNamesBodySchema.parse(request.body ?? {});
      return resolveSeibanMachineDisplayNamesBatched(body.fseibans);
    }
  );
}
