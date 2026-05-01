import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { authorizeRoles } from '../../lib/auth.js';
import { createDgxResourceService } from '../../services/system/dgx-resource/dgx-resource.service.js';
import { getDgxResourcePolicyStore } from '../../services/system/dgx-resource/dgx-resource.policy-store.js';
import type { DgxResourceServicePort } from '../../services/system/dgx-resource/dgx-resource.service.js';
import { getInferenceRuntime } from '../../services/inference/inference-runtime.js';

const actionBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('LOCAL_LLM_START'),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    type: z.literal('LOCAL_LLM_STOP'),
    reason: z.string().trim().max(200).optional(),
  }),
  z.object({
    type: z.literal('SET_POLICY'),
    policyMode: z.enum(['business_first', 'private_ok']),
  }),
]);

function resolveDgxResourceService(app: FastifyInstance): DgxResourceServicePort {
  return createDgxResourceService({
    fetchImpl: (input, init) => fetch(input, init),
    localLlmGateway: app.localLlmGateway,
    getAdminLocalLlmRuntimeConfig: () => getInferenceRuntime().getAdminLocalLlmRuntimeConfig(),
    policyStore: getDgxResourcePolicyStore(env.DGX_RESOURCE_EVENT_LOG_MAX),
    probeTimeoutMs: env.DGX_RESOURCE_PROBE_TIMEOUT_MS,
    metricsUrl: env.DGX_RESOURCE_METRICS_URL,
    comfyHealthUrl: env.DGX_RESOURCE_COMFYUI_HEALTH_URL,
    embeddingHealthUrl: env.DGX_RESOURCE_EMBEDDING_HEALTH_URL,
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
      limit: z.coerce.number().int().min(1).max(100).default(30),
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
