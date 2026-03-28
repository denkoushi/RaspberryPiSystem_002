import 'fastify';
import type { UserRole } from '@prisma/client';
import type { SignageRenderScheduler } from '../services/signage/signage-render-scheduler.js';
import type { LocalLlmGateway } from '../services/system/local-llm-proxy.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      username: string;
      role: UserRole;
    };
  }

  interface FastifyInstance {
    signageRenderScheduler: SignageRenderScheduler;
    localLlmGateway: LocalLlmGateway;
  }
}
