import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeParamsSchema } from './schemas.js';

export function registerEmployeeDeleteRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.delete('/employees/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const params = employeeParamsSchema.parse(request.params);
    const employee = await employeeService.delete(params.id);
    return { employee };
  });
}

