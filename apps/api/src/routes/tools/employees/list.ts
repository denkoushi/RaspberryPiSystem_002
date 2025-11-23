import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeQuerySchema } from './schemas.js';

export function registerEmployeeListRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/employees', { preHandler: canView }, async (request) => {
    const query = employeeQuerySchema.parse(request.query);
    const employees = await employeeService.findAll(query);
    return { employees };
  });
}

