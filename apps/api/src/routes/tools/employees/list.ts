import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../../lib/auth.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeQuerySchema } from './schemas.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export function registerEmployeeListRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/employees', { preHandler: canView, config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request) => {
    const query = employeeQuerySchema.parse(request.query);
    const employees = await employeeService.findAll(query);
    return {
      employees: request.user?.role === 'VIEWER'
        ? employees.map((employee) => ({ ...employee, nfcTagUid: null }))
        : employees
    };
  });
}

