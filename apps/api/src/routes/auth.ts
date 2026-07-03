import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles, authenticate } from '../lib/auth.js';
import { UserRole } from '@prisma/client';
import { AuthRoleAdminService } from '../services/auth/auth-role-admin.service.js';
import { AuthService } from '../services/auth/auth.service.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().optional(),
  backupCode: z.string().optional(),
  rememberMe: z.boolean().optional()
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

const mfaInitiateSchema = z.object({
  // no input; reserved for future options
});

const mfaActivateSchema = z.object({
  secret: z.string().min(10),
  code: z.string().min(6),
  backupCodes: z.array(z.string().min(4)).min(1)
});

const mfaDisableSchema = z.object({
  password: z.string().min(1)
});

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'VIEWER'])
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).optional()
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const authRateLimit = { max: 10, timeWindow: '1 minute' };
  const authService = new AuthService();
  const authRoleAdminService = new AuthRoleAdminService();

  app.post('/auth/login', { config: { rateLimit: authRateLimit } }, async (request) => {
    const body = loginSchema.parse(request.body);
    return authService.login(body);
  });

  app.post('/auth/refresh', { config: { rateLimit: authRateLimit } }, async (request) => {
    const body = refreshTokenSchema.parse(request.body);
    return authService.refresh(body);
  });

  app.post('/auth/mfa/initiate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    mfaInitiateSchema.parse(request.body ?? {});
    return authService.initiateMfa(request.user!.id);
  });

  app.post('/auth/mfa/activate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    const body = mfaActivateSchema.parse(request.body);
    return authService.activateMfa(request.user!.id, body);
  });

  app.post('/auth/mfa/disable', { preHandler: authenticate }, async (request) => {
    const body = mfaDisableSchema.parse(request.body);
    return authService.disableMfa(request.user!.id, body);
  });

  app.post('/auth/users/:id/role', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    return authRoleAdminService.updateUserRole({
      actorUser: {
        id: request.user!.id,
        username: request.user!.username,
      },
      targetUserId: params.id,
      nextRole: body.role as UserRole,
      logger: request.server.log,
    });
  });

  app.get('/auth/role-audit', { preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    const limit = query.limit ?? 100;
    return authService.getRoleAuditLogs(limit);
  });
}
