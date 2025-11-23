import type { FastifyInstance } from 'fastify';
import { ItemService } from '../../../services/tools/item.service.js';
import { registerItemListRoute } from './list.js';
import { registerItemGetRoute } from './get.js';
import { registerItemCreateRoute } from './create.js';
import { registerItemUpdateRoute } from './update.js';
import { registerItemDeleteRoute } from './delete.js';

export async function registerItemRoutes(app: FastifyInstance): Promise<void> {
  const itemService = new ItemService();

  registerItemListRoute(app, itemService);
  registerItemGetRoute(app, itemService);
  registerItemCreateRoute(app, itemService);
  registerItemUpdateRoute(app, itemService);
  registerItemDeleteRoute(app, itemService);
}

