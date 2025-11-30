import 'fastify';
import type { UserRole } from '@prisma/client';
import type { SignageRenderScheduler } from '../services/signage/signage-render-scheduler.js';

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
  }
}
