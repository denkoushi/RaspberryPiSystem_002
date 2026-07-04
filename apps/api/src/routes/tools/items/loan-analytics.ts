import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { assertKioskApiClientKeyValid } from '../../../services/clients/client-device-auth.service.js';
import { ItemLoanAnalyticsService } from '../../../services/tools/item-loan-analytics.service.js';
import { itemLoanAnalyticsQuerySchema } from './schemas.js';

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
      } catch {
        // fall back
      }
    }
    await allowClientKey(request);
    if (reply.statusCode === 401) {
      reply.code(200);
    }
  };

  app.get('/items/loan-analytics', { preHandler: allowView, config: { rateLimit: false } }, async (request) => {
    const query = itemLoanAnalyticsQuerySchema.parse(request.query);
    return service.getDashboard(query);
  });
}
