import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemCreateSchema } from './schemas.js';

export function registerItemCreateRoute(app: FastifyInstance, itemService: ItemService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.post('/items', { preHandler: canEdit }, async (request) => {
    const body = itemCreateSchema.parse(request.body);
    const item = await itemService.create(body);
    return { item };
  });
}

