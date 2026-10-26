import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../../services/production-schedule/production-schedule-settings.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const recordApprovalAccessPasswordVerifyBodySchema = z.object({
  password: z.string().min(1).max(128)
});

const recordApprovalAccessPasswordRateLimit = { max: 10, timeWindow: '1 minute' };

export async function registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.post(
    '/kiosk/part-measurement/self-inspection/record-approvals/verify-access-password',
    { config: { rateLimit: recordApprovalAccessPasswordRateLimit } },
    async (request) => {
      await deps.requireClientDevice(request.headers['x-client-key']);
      const body = recordApprovalAccessPasswordVerifyBodySchema.parse(request.body);
      return verifyDueManagementAccessPassword({
        location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
        password: body.password
      });
    }
  );
}
