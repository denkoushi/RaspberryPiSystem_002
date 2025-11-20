import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import pkg from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authorizeRoles } from '../lib/auth.js';
import { ApiError } from '../lib/errors.js';

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

  app.get('/employees', { preHandler: canView }, async (request) => {
    const query = employeeQuerySchema.parse(request.query);
    const where: Prisma.EmployeeWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { employeeCode: { contains: query.search, mode: 'insensitive' } }
            ]
          }
        : {})
    };

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { displayName: 'asc' }
    });
    return { employees };
  });

  app.get('/employees/:id', { preHandler: canView }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const employee = await prisma.employee.findUnique({ where: { id: params.id } });
    if (!employee) {
      throw new ApiError(404, '従業員が見つかりません');
    }
    return { employee };
  });

  app.post('/employees', { preHandler: canEdit }, async (request) => {
    const body = employeeBodySchema.parse(request.body);
    const employee = await prisma.employee.create({
      data: {
        employeeCode: body.employeeCode,
        displayName: body.displayName,
        nfcTagUid: body.nfcTagUid ?? undefined,
        department: body.department ?? undefined,
        contact: body.contact ?? undefined,
        status: body.status ?? EmployeeStatus.ACTIVE
      }
    });
    return { employee };
  });

  app.put('/employees/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = employeeUpdateSchema.parse(request.body);
    const employee = await prisma.employee.update({
      where: { id: params.id },
      data: body
    });
    return { employee };
  });

  app.delete('/employees/:id', { preHandler: canEdit }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const employee = await prisma.employee.delete({ where: { id: params.id } });
    return { employee };
  });
}
