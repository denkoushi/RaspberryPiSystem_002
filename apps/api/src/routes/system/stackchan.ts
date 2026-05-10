import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authorizeRoles } from '../../lib/auth.js';
import { mergeStackChanDetailSystemPrompt } from '../../services/system/stackchan-chat-request.js';
import { withStackChanChatOnDemandRuntime } from '../../services/system/local-llm-on-demand-runtime.js';

const stackChanChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(20_000),
      })
    )
    .min(1)
    .max(50),
  /** 詳説優先の既定は admin チャットより大きめ（上書き可） */
  maxTokens: z.coerce.number().int().min(1).max(4096).default(1536),
  temperature: z.coerce.number().min(0).max(2).default(0.35),
  enableThinking: z.boolean().default(false),
});

export function registerStackChanRoutes(app: FastifyInstance): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.post('/system/stackchan/chat', { preHandler: canManage }, async (request) => {
    const body = stackChanChatBodySchema.parse(request.body);
    const merged = {
      ...body,
      messages: mergeStackChanDetailSystemPrompt(body.messages),
    };
    return withStackChanChatOnDemandRuntime(() => app.localLlmGateway.createChatCompletion(merged));
  });
}
