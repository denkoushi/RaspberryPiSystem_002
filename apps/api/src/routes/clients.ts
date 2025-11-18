import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authorizeRoles } from '../lib/auth.js';

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
}
