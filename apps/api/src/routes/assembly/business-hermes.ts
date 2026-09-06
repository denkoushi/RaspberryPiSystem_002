import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import {
  BUSINESS_HERMES_CHAT_SCOPES,
  BusinessHermesChatService,
  type BusinessHermesChatUserMessage
} from '../../services/assembly/business-hermes-chat.service.js';
import { BusinessHermesService, BUSINESS_HERMES_EVENT_CODES } from '../../services/assembly/business-hermes.service.js';
import type { requireClientDevice } from '../kiosk/shared.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const guideBodySchema = z.object({
  uiRevision: z.string().trim().min(1).max(512),
  eventCode: z.enum(BUSINESS_HERMES_EVENT_CODES)
});
const suggestionsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const chatBodySchema = z.object({
  scope: z.enum(BUSINESS_HERMES_CHAT_SCOPES).default('both'),
  partNumber: z.string().trim().min(1).max(200).optional(),
  shootingTarget: z.string().trim().min(1).max(200).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4_000)
  })).min(1).max(12)
}).strict();

type RequireClientDevice = typeof requireClientDevice;

export type BusinessHermesRouteDeps = {
  requireClientDevice: RequireClientDevice;
  service?: BusinessHermesService;
  chatService?: Pick<BusinessHermesChatService, 'chat'>;
};

export async function registerBusinessHermesRoutes(
  app: FastifyInstance,
  deps: BusinessHermesRouteDeps
): Promise<void> {
  const service = deps.service ?? new BusinessHermesService();
  const chatService = deps.chatService ?? new BusinessHermesChatService({ hermes: service });

  app.post('/assembly/business-hermes/chat', {
    preHandler: async (request, reply) => {
      await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
    },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
  }, async (request) => {
    const body = chatBodySchema.parse(request.body);
    return chatService.chat({
      ...body,
      messages: body.messages as BusinessHermesChatUserMessage[]
    });
  });

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
