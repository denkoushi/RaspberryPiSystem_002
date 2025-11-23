import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeBodySchema } from './schemas.js';

export function registerEmployeeCreateRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.post('/employees', { preHandler: canEdit }, async (request) => {
    const body = employeeBodySchema.parse(request.body);
    const employee = await employeeService.create(body);
    return { employee };
  });
}

