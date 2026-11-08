import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
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
  password: z.string().min(1),
  currentCode: z.string().optional(),
  currentBackupCode: z.string().optional(),
  secret: z.string().min(10),
  code: z.string().min(6),
  backupCodes: z.array(z.string().min(4)).min(1).max(10)
});

const mfaDisableSchema = z.object({
  password: z.string().min(1)
});

const updateRoleSchema = z.object({
  currentPassword: z.string().min(1),
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

  app.post('/auth/logout', { preHandler: authenticate }, async (request) => {
    await prisma.authSession.updateMany({ where: { id: request.user!.sessionId!, userId: request.user!.id }, data: { revokedAt: new Date() } });
    return { success: true };
  });

  app.post('/auth/mfa/initiate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    mfaInitiateSchema.parse(request.body ?? {});
    return authService.initiateMfa(request.user!.id);
  });

  app.post('/auth/mfa/activate', { preHandler: authorizeRoles('ADMIN', 'MANAGER') }, async (request) => {
    const body = mfaActivateSchema.parse(request.body);
    return authService.activateMfa(request.user!.id, body, request.user!.sessionId!);
  });

  app.post('/auth/mfa/disable', { config: { rateLimit: authRateLimit }, preHandler: authenticate }, async (request) => {
    const body = mfaDisableSchema.parse(request.body);
    return authService.disableMfa(request.user!.id, body, request.user!.sessionId);
  });

  app.post('/auth/users/:id/role', { config: { rateLimit: authRateLimit }, preHandler: authorizeRoles('ADMIN') }, async (request) => {
    const params = z.object({ id: z.string().guid() }).parse(request.params);
    const body = updateRoleSchema.parse(request.body);
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (!await bcrypt.compare(body.currentPassword, actor.passwordHash)) throw new ApiError(401, 'パスワードが違います', undefined, 'AUTH_PASSWORD_MISMATCH');
    return authRoleAdminService.updateUserRole({
      actorSessionId: request.user!.sessionId,
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
