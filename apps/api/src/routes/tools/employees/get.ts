import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeParamsSchema } from './schemas.js';

export function registerEmployeeGetRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/employees/:id', { preHandler: canView }, async (request) => {
    const params = employeeParamsSchema.parse(request.params);
    const employee = await employeeService.findById(params.id);
    return { employee };
  });
}

