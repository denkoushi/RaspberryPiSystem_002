import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { BusinessHermesService, BUSINESS_HERMES_EVENT_CODES } from '../../services/assembly/business-hermes.service.js';
import type { requireClientDevice } from '../kiosk/shared.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const guideBodySchema = z.object({
  uiRevision: z.string().trim().min(1).max(512),
  eventCode: z.enum(BUSINESS_HERMES_EVENT_CODES)
});
const suggestionsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

type RequireClientDevice = typeof requireClientDevice;

export type BusinessHermesRouteDeps = {
  requireClientDevice: RequireClientDevice;
  service?: BusinessHermesService;
};

export async function registerBusinessHermesRoutes(
  app: FastifyInstance,
  deps: BusinessHermesRouteDeps
): Promise<void> {
  const service = deps.service ?? new BusinessHermesService();

  app.post('/assembly/work-sessions/:id/hermes-guide', { preHandler: async (request) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
  } }, async (request) => {
    const params = paramsSchema.parse(request.params);
    const body = guideBodySchema.parse(request.body);
    const { clientDevice } = await deps.requireClientDevice(request.headers['x-client-key']);
    return service.guide({
      sessionId: params.id,
      clientDeviceId: clientDevice.id,
      uiRevision: body.uiRevision,
      eventCode: body.eventCode
    });
  });

  app.get('/assembly/business-hermes/proactive-suggestions', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const query = suggestionsQuerySchema.parse(request.query);
    return { suggestions: await service.listProactiveSuggestions(query.limit) };
  });
}
