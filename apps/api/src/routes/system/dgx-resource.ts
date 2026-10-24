import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';

import { env } from '../../config/env.js';
import { authorizeRoles } from '../../lib/auth.js';
import { createDgxResourceService } from '../../services/system/dgx-resource/dgx-resource.service.js';
import { getDgxResourceStateStore } from '../../services/system/dgx-resource/dgx-resource.state-store.js';
import type { DgxResourceServicePort } from '../../services/system/dgx-resource/dgx-resource.service.js';
import { getInferenceRuntime } from '../../services/inference/inference-runtime.js';

const modelProfileIdSchema = z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/);

const actionBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RETURN_TO_BUSINESS'), modelProfileId: modelProfileIdSchema }),
  z.object({ type: z.literal('STOP_BUSINESS_LLM') }),
  z.object({
    type: z.literal('PREVIEW_MODEL_STORAGE_DELETE'),
    modelProfileId: modelProfileIdSchema,
  }),
  z.object({
    type: z.literal('EXECUTE_MODEL_STORAGE_DELETE'),
    modelProfileId: modelProfileIdSchema,
    planFingerprint: z.string().trim().min(32).max(128),
    confirmation: z.string().trim().min(1).max(160),
  }),
]);

function resolveDgxResourceService(app: FastifyInstance): DgxResourceServicePort {
  return createDgxResourceService({
    fetchImpl: (input, init) => fetch(input, init),
    localLlmGateway: app.localLlmGateway,
    getAdminLocalLlmRuntimeConfig: () => getInferenceRuntime().getAdminLocalLlmRuntimeConfig(),
    stateStore: getDgxResourceStateStore(env.DGX_RESOURCE_EVENT_LOG_MAX),
    probeTimeoutMs: env.DGX_RESOURCE_PROBE_TIMEOUT_MS,
    metricsUrl: env.DGX_RESOURCE_METRICS_URL,
  });
}

export function registerDgxResourceRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/system/dgx-resource/overview', { preHandler: canManage }, async (_request, reply) => {
    const overview = await resolveDgxResourceService(app).getOverview();
    return reply.send(overview);
  });

  app.get('/system/dgx-resource/events', { preHandler: canManage }, async (request, reply) => {
    const qSchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    });
    const { limit } = qSchema.parse(request.query);
    const events = resolveDgxResourceService(app).getEvents(limit);
    return reply.send({ events });
  });

  app.post('/system/dgx-resource/actions', { preHandler: canManage }, async (request, reply) => {
    const body = actionBodySchema.parse(request.body);
    const result = await resolveDgxResourceService(app).executeAction(body);
    return reply.send(result);
  });
}
