import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeParamsSchema, employeeUpdateSchema } from './schemas.js';

export function registerEmployeeUpdateRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.put('/employees/:id', { preHandler: canEdit }, async (request) => {
    const params = employeeParamsSchema.parse(request.params);
    const body = employeeUpdateSchema.parse(request.body);
    const employee = await employeeService.update(params.id, body);
    return { employee };
  });
}

