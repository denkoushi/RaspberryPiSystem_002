import type { FastifyInstance } from 'fastify';

import { EmployeeService } from '../../services/tools/employee.service.js';

type EmployeesRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<unknown>;
};

export async function registerKioskEmployeesRoute(
  app: FastifyInstance,
  deps: EmployeesRouteDeps
): Promise<void> {
  const employeeService = new EmployeeService();

  // キオスク専用の従業員リスト取得エンドポイント（x-client-key認証のみ）
  app.get('/kiosk/employees', { config: { rateLimit: false } }, async (request) => {
    const rawClientKey = request.headers['x-client-key'];
    await deps.requireClientDevice(rawClientKey);

    const employees = await employeeService.listActiveForKiosk();

    return { employees };
  });
}
