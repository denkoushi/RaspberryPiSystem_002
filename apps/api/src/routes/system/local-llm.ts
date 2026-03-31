import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { withAdminConsoleChatOnDemandRuntime } from '../../services/system/local-llm-on-demand-runtime.js';

const localLlmChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(20_000),
      })
    )
    .min(1)
    .max(50),
  maxTokens: z.coerce.number().int().min(1).max(4096).default(512),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  enableThinking: z.boolean().default(false),
});

export function registerLocalLlmRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/system/local-llm/status', { preHandler: canManage }, async (_request, reply) => {
    const status = await app.localLlmGateway.getStatus();
    const statusCode = status.configured && status.health.ok ? 200 : 503;
    return reply.status(statusCode).send(status);
  });

  app.post('/system/local-llm/chat/completions', { preHandler: canManage }, async (request) => {
    const body = localLlmChatBodySchema.parse(request.body);
    return withAdminConsoleChatOnDemandRuntime(() => app.localLlmGateway.createChatCompletion(body));
  });
}
