import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemQuerySchema } from './schemas.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export function registerItemListRoute(app: FastifyInstance, itemService: ItemService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/items', { preHandler: canView, config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const query = itemQuerySchema.parse(request.query);
    const items = await itemService.findAll(query);
    return { items };
  });
}

