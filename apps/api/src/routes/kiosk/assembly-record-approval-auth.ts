import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signKioskAccessToken } from '../../lib/auth.js';

import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPasswordForToken
} from '../../services/production-schedule/production-schedule-settings.service.js';
import type { KioskRouteDeps } from './production-schedule/shared.js';

const assemblyRecordApprovalAccessPasswordVerifyBodySchema = z.object({
  password: z.string().min(1).max(128)
});

const assemblyRecordApprovalAccessPasswordRateLimit = { max: 10, timeWindow: '1 minute' };

export async function registerKioskAssemblyRecordApprovalAuthRoute(
  app: FastifyInstance,
  deps: KioskRouteDeps
): Promise<void> {
  app.post(
    '/kiosk/assembly/record-approvals/verify-access-password',
    { config: { rateLimit: assemblyRecordApprovalAccessPasswordRateLimit } },
    async (request) => {
      const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
      const body = assemblyRecordApprovalAccessPasswordVerifyBodySchema.parse(request.body);
      const result = await verifyDueManagementAccessPasswordForToken({
        location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
        clientDeviceId: clientDevice.id,
        ip: request.ip,
        password: body.password
      });
      return result.success
        ? { success: true, token: signKioskAccessToken('assembly-record-approval', clientDevice.id, '12h', result.passwordChangedAt) }
        : { success: false };
    }
  );
}
