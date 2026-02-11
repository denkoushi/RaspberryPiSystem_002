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

const createMachineSchema = z.object({
  equipmentManagementNumber: z.string().min(1, '設備管理番号は必須です'),
  name: z.string().min(1, '加工機名称は必須です'),
  shortName: z.string().optional(),
  classification: z.string().optional(),
  operatingStatus: z.string().optional(),
  ncManual: z.string().optional(),
  maker: z.string().optional(),
  processClassification: z.string().optional(),
  coolant: z.string().optional(),
});

const updateMachineSchema = z.object({
  name: z.string().optional(),
  shortName: z.string().optional(),
  classification: z.string().optional(),
  operatingStatus: z.string().optional(),
  ncManual: z.string().optional(),
  maker: z.string().optional(),
  processClassification: z.string().optional(),
  coolant: z.string().optional(),
});

export async function registerMachineRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');
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

  app.post('/machines', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const payload = createMachineSchema.parse(request.body);
    const machine = await service.create(payload);
    return { machine };
  });

  app.put('/machines/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const { id } = request.params as { id: string };
    const payload = updateMachineSchema.parse(request.body);
    const machine = await service.update(id, payload);
    return { machine };
  });

  app.delete('/machines/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const { id } = request.params as { id: string };
    await service.delete(id);
    return { success: true };
  });
}
