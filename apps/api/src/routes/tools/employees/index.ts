import type { FastifyInstance } from 'fastify';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { registerEmployeeListRoute } from './list.js';
import { registerEmployeeGetRoute } from './get.js';
import { registerEmployeeCreateRoute } from './create.js';
import { registerEmployeeUpdateRoute } from './update.js';
import { registerEmployeeDeleteRoute } from './delete.js';

export async function registerEmployeeRoutes(app: FastifyInstance): Promise<void> {
  const employeeService = new EmployeeService();

  registerEmployeeListRoute(app, employeeService);
  registerEmployeeGetRoute(app, employeeService);
  registerEmployeeCreateRoute(app, employeeService);
  registerEmployeeUpdateRoute(app, employeeService);
  registerEmployeeDeleteRoute(app, employeeService);
}

