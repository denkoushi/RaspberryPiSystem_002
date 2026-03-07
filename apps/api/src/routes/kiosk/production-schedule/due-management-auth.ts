import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../../../services/production-schedule/production-schedule-settings.service.js';
import type { KioskRouteDeps } from './shared.js';

const dueManagementAccessPasswordVerifyBodySchema = z.object({
  password: z.string().min(1).max(128)
});

export async function registerProductionScheduleDueManagementAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.post('/kiosk/production-schedule/due-management/verify-access-password', { config: { rateLimit: false } }, async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const body = dueManagementAccessPasswordVerifyBodySchema.parse(request.body);
    return verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      password: body.password
    });
  });
}
