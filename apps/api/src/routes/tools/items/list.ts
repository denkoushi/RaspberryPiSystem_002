import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemQuerySchema } from './schemas.js';

export function registerItemListRoute(app: FastifyInstance, itemService: ItemService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/items', { preHandler: canView, config: { rateLimit: false } }, async (request) => {
    const query = itemQuerySchema.parse(request.query);
    const items = await itemService.findAll(query);
    return { items };
  });
}

