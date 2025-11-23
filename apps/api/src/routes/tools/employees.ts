import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import pkg from '@prisma/client';
import { authorizeRoles } from '../../lib/auth.js';
import { EmployeeService } from '../../services/tools/employee.service.js';

const { EmployeeStatus } = pkg;

const employeeBodySchema = z.object({
  employeeCode: z.string().min(1),
  displayName: z.string().min(1),
  nfcTagUid: z.string().min(4).optional().or(z.literal('').transform(() => undefined)).nullable(),
  department: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  status: z.nativeEnum(EmployeeStatus).optional()
});

const employeeUpdateSchema = employeeBodySchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: '更新項目がありません'
});

const employeeQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(EmployeeStatus).optional()
});

export async function registerEmployeeRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');
  const employeeService = new EmployeeService();

  app.get('/employees', { preHandler: canView }, async (request) => {
    const query = employeeQuerySchema.parse(request.query);
    const employees = await employeeService.findAll(query);
    return { employees };
  });

  app.get('/employees/:id', { preHandler: canView }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const employee = await employeeService.findById(params.id);
    return { employee };
  });

  app.post('/employees', { preHandler: canEdit }, async (request) => {
    const body = employeeBodySchema.parse(request.body);
    const employee = await employeeService.create(body);
    return { employee };
  });

  app.put('/employees/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = employeeUpdateSchema.parse(request.body);
    const employee = await employeeService.update(params.id, body);
    return { employee };
  });

  app.delete('/employees/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const employee = await employeeService.delete(params.id);
    return { employee };
  });
}
