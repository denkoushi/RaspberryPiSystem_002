import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { assertKioskApiClientKeyValid } from '../../../services/clients/client-device-auth.service.js';
import { ItemLoanAnalyticsService } from '../../../services/tools/item-loan-analytics.service.js';
import { itemLoanAnalyticsQuerySchema } from './schemas.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export function registerItemLoanAnalyticsRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const service = ItemLoanAnalyticsService.createDefault();

  const allowClientKey = async (request: FastifyRequest) => {
    await assertKioskApiClientKeyValid(request.headers['x-client-key']);
  };

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'MFA_SETUP_REQUIRED') throw error;
        // fall back
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  app.get('/items/loan-analytics', { preHandler: allowView, config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const query = itemLoanAnalyticsQuerySchema.parse(request.query);
    return service.getDashboard(query);
  });
}
