import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemParamsSchema, itemUpdateSchema } from './schemas.js';

export function registerItemUpdateRoute(app: FastifyInstance, itemService: ItemService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.put('/items/:id', { preHandler: canEdit }, async (request) => {
    const params = itemParamsSchema.parse(request.params);
    const body = itemUpdateSchema.parse(request.body);
    const item = await itemService.update(params.id, body);
    return { item };
  });
}

