import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../../lib/auth.js';
import { MachineService } from '../../../services/tools/machine.service.js';

const machineListQuerySchema = z.object({
  search: z.string().optional(),
  operatingStatus: z.string().optional(),
});

const uninspectedQuerySchema = z.object({
  csvDashboardId: z.string().uuid('csvDashboardIdはUUID形式で指定してください'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateはYYYY-MM-DD形式で指定してください').optional(),
});

export async function registerMachineRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const service = new MachineService();

  app.get('/machines', { preHandler: canView, config: { rateLimit: false } }, async (request) => {
    const query = machineListQuerySchema.parse(request.query);
    const machines = await service.findAll(query);
    return { machines };
  });

  app.get('/machines/uninspected', { preHandler: canView, config: { rateLimit: false } }, async (request) => {
    const query = uninspectedQuerySchema.parse(request.query);
    const result = await service.findUninspected(query);
    return result;
  });
}
