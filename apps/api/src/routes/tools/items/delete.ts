import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemParamsSchema } from './schemas.js';

export function registerItemDeleteRoute(app: FastifyInstance, itemService: ItemService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.delete('/items/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const params = itemParamsSchema.parse(request.params);
    const item = await itemService.delete(params.id);
    return { item };
  });
}

