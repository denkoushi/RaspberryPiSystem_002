import type { FastifyInstance } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { ItemService } from '../../../services/tools/item.service.js';
import { itemParamsSchema } from './schemas.js';

export function registerItemDeleteRoute(app: FastifyInstance, itemService: ItemService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.delete('/items/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const params = itemParamsSchema.parse(request.params);
    try {
      const item = await itemService.delete(params.id);
      return { item };
    } catch (error) {
      // PrismaのP2025エラー（レコードが見つからない）を404に変換
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'アイテムが見つかりません');
      }
      throw error;
    }
  });
}

