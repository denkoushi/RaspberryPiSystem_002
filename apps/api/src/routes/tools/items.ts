import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import pkg from '@prisma/client';
import { authorizeRoles } from '../../lib/auth.js';
import { ItemService } from '../../services/tools/item.service.js';

const { ItemStatus } = pkg;

const baseItemSchema = z.object({
  itemCode: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  category: z.string().optional().nullable(),
  storageLocation: z.string().optional().nullable(),
  status: z.nativeEnum(ItemStatus).optional(),
  notes: z.string().optional().nullable()
});

const itemCreateSchema = baseItemSchema;
const itemUpdateSchema = baseItemSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

const itemQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(ItemStatus).optional()
});

export async function registerItemRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');
  const itemService = new ItemService();

  app.get('/items', { preHandler: canView }, async (request) => {
    const query = itemQuerySchema.parse(request.query);
    const items = await itemService.findAll(query);
    return { items };
  });

  app.get('/items/:id', { preHandler: canView }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await itemService.findById(params.id);
    return { item };
  });

  app.post('/items', { preHandler: canEdit }, async (request) => {
    const body = itemCreateSchema.parse(request.body);
    const item = await itemService.create(body);
    return { item };
  });

  app.put('/items/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = itemUpdateSchema.parse(request.body);
    const item = await itemService.update(params.id, body);
    return { item };
  });

  app.delete('/items/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await itemService.delete(params.id);
    return { item };
  });
}
