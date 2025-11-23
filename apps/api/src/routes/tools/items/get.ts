import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemParamsSchema } from './schemas.js';

export function registerItemGetRoute(app: FastifyInstance, itemService: ItemService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/items/:id', { preHandler: canView }, async (request) => {
    const params = itemParamsSchema.parse(request.params);
    const item = await itemService.findById(params.id);
    return { item };
  });
}

