import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { authorizeKioskClientKeyOrJwtRoles } from '../../lib/kiosk-document-auth.js';
import {
  BUSINESS_HERMES_CHAT_SCOPES,
  BusinessHermesChatService,
  type BusinessHermesChatUserMessage
} from '../../services/assembly/business-hermes-chat.service.js';
import { BusinessHermesService, BUSINESS_HERMES_EVENT_CODES } from '../../services/assembly/business-hermes.service.js';
import {
  BusinessHermesConsultationService
} from '../../services/assembly/business-hermes-consultation.service.js';
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
  })).min(1).max(12).optional(),
  consultationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4_000).optional(),
  selection: z.object({
    prompt: z.string().trim().min(1).max(500),
    option: z.string().trim().min(1).max(120)
  }).optional(),
  scanValue: z.string().trim().min(1).max(500).optional()
}).strict().superRefine((body, ctx) => {
  if (body.consultationId && !body.message) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message: 'message is required for consultation chat' });
  if (!body.consultationId && !body.messages) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messages'], message: 'messages is required for legacy chat' });
  if (body.scanValue && !body.consultationId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['consultationId'], message: 'scanValue requires consultation chat' });
});
const consultationCreateSchema = z.object({ title: z.string().trim().min(1).max(200).optional() }).strict();
const consultationPatchSchema = z.object({ title: z.string().trim().max(200).nullable().optional(), relatedIdentifiers: z.array(z.string().trim().min(1).max(500)).max(50).optional() }).strict();

type RequireClientDevice = typeof requireClientDevice;

export type BusinessHermesRouteDeps = {
  requireClientDevice: RequireClientDevice;
  service?: BusinessHermesService;
  chatService?: Pick<BusinessHermesChatService, 'chat'>;
  consultationService?: Pick<BusinessHermesConsultationService, 'list' | 'create' | 'get' | 'update' | 'chat' | 'cancel'>
    & Partial<Pick<BusinessHermesConsultationService, 'getPage' | 'isEnabled' | 'feedback'>>;
};

// The web app sends both headers. Preserve the signed-in actor for approval.
async function authorizeConsultation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.headers.authorization) {
    await authorizeRoles('ADMIN', 'MANAGER', 'VIEWER')(request, reply);
  } else {
    await authorizeKioskClientKeyOrJwtRoles(request, reply, ['ADMIN', 'MANAGER', 'VIEWER']);
  }
}

export async function registerBusinessHermesRoutes(
  app: FastifyInstance,
  deps: BusinessHermesRouteDeps
): Promise<void> {
  const service = deps.service ?? new BusinessHermesService();
  const chatService = deps.chatService ?? new BusinessHermesChatService({ hermes: service });
  const consultationService = deps.consultationService ?? new BusinessHermesConsultationService();

  app.get('/assembly/business-hermes/consultations', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }
  }, async () => ({ consultations: await consultationService.list(), enabled: typeof consultationService.isEnabled === 'function' ? consultationService.isEnabled() : true }));

  app.post('/assembly/business-hermes/consultations', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }
  }, async (request) => {
    const body = consultationCreateSchema.parse(request.body ?? {});
    return { consultation: await consultationService.create({ title: body.title, createdByUserId: request.user?.id ?? null }) };
  });

  app.get('/assembly/business-hermes/consultations/:id', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }
  }, async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const query = z.object({ messageCursor: z.string().uuid().optional() }).parse(request.query ?? {});
    const consultation = typeof consultationService.getPage === 'function'
      ? await consultationService.getPage(params.id, query.messageCursor)
      : await consultationService.get(params.id);
    if (!consultation) return reply.code(404).send({ code: 'BUSINESS_HERMES_CONSULTATION_NOT_FOUND' });
    return { consultation };
  });

  app.post('/assembly/business-hermes/consultations/:id/cancel', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }
  }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    return { cancelled: await consultationService.cancel(id) };
  });

  app.patch('/assembly/business-hermes/consultations/:id', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }
  }, async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = consultationPatchSchema.parse(request.body ?? {});
    const consultation = await consultationService.update(params.id, body);
    if (!consultation) return reply.code(404).send({ code: 'BUSINESS_HERMES_CONSULTATION_NOT_FOUND' });
    return { consultation };
  });

  app.post('/assembly/business-hermes/consultations/:id/feedback', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = z.object({ messageId: z.string().uuid(), verdict: z.enum(['helpful', 'unhelpful']) }).strict().parse(request.body);
    const recorded = await consultationService.feedback?.(id, body.messageId, body.verdict);
    if (!recorded) return reply.code(409).send({ code: 'HERMES_FEEDBACK_NOT_RECORDED' });
    return { recorded: true };
  });

  app.post('/assembly/business-hermes/chat', {
    preHandler: async (request, reply) => {
      await authorizeConsultation(request, reply);
    },
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = chatBodySchema.parse(request.body);
    if (body.consultationId && body.message) {
      const abortController = new AbortController();
      const onClose = () => {
        if (!reply.raw.writableEnded) abortController.abort();
      };
      reply.raw.once('close', onClose);
      try {
        return await consultationService.chat({
          consultationId: body.consultationId,
          message: body.message,
          selection: body.selection,
          scanValue: body.scanValue,
          actor: request.user ? { userId: request.user.id, role: request.user.role } : undefined,
          signal: abortController.signal
        });
      } finally {
        reply.raw.off('close', onClose);
      }
    }
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
