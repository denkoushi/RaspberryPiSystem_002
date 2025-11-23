import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authorizeRoles } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';

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

  app.get('/items', { preHandler: canView }, async (request) => {
    const query = itemQuerySchema.parse(request.query);
    const where: Prisma.ItemWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { itemCode: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };
    const items = await prisma.item.findMany({ where, orderBy: { name: 'asc' } });
    return { items };
  });

  app.get('/items/:id', { preHandler: canView }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await prisma.item.findUnique({ where: { id: params.id } });
    if (!item) {
      throw new ApiError(404, 'アイテムが見つかりません');
    }
    return { item };
  });

  app.post('/items', { preHandler: canEdit }, async (request) => {
    const body = itemCreateSchema.parse(request.body);
    const item = await prisma.item.create({
      data: {
        itemCode: body.itemCode,
        name: body.name,
        description: body.description ?? undefined,
        nfcTagUid: body.nfcTagUid ?? undefined,
        category: body.category ?? undefined,
        storageLocation: body.storageLocation ?? undefined,
        status: body.status ?? ItemStatus.AVAILABLE,
        notes: body.notes ?? undefined
      }
    });
    return { item };
  });

  app.put('/items/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = itemUpdateSchema.parse(request.body);
    const item = await prisma.item.update({ where: { id: params.id }, data: body });
    return { item };
  });

  app.delete('/items/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await prisma.item.delete({ where: { id: params.id } });
    return { item };
  });
}
