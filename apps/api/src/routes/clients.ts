import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma.js';
import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';

const heartbeatSchema = z.object({
  apiKey: z.string().min(8),
  name: z.string().min(1),
  location: z.string().optional().nullable()
});

export async function registerClientRoutes(app: FastifyInstance): Promise<void> {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.post('/clients/heartbeat', async (request) => {
    const body = heartbeatSchema.parse(request.body);

    const client = await prisma.clientDevice.upsert({
      where: { apiKey: body.apiKey },
      update: {
        name: body.name,
        location: body.location ?? undefined,
        lastSeenAt: new Date()
      },
      create: {
        name: body.name,
        location: body.location ?? undefined,
        apiKey: body.apiKey,
        lastSeenAt: new Date()
      }
    });

    return { client };
  });

  app.get('/clients', { preHandler: canManage }, async () => {
    const clients = await prisma.clientDevice.findMany({ orderBy: { name: 'asc' } });
    return { clients };
  });

  const updateClientSchema = z.object({
    defaultMode: z.enum(['PHOTO', 'TAG']).optional().nullable()
  });

  app.put('/clients/:id', { preHandler: canManage }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updateClientSchema.parse(request.body);

    try {
      const client = await prisma.clientDevice.update({
        where: { id },
        data: {
          defaultMode: body.defaultMode ?? undefined
        }
      });

      return { client };
    } catch (error) {
      // PrismaのP2025エラー（レコードが見つからない）を404に変換
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'クライアントデバイスが見つかりません');
      }
      throw error;
    }
  });
}
