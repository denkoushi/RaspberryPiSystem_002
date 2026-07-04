import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { EmployeeService } from '../../services/tools/employee.service.js';

/**
 * 部署一覧取得エンドポイント
 * 従業員マスターのdepartmentフィールドから重複を除いた部署一覧を返す
 */
export function registerDepartmentsRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const employeeService = new EmployeeService();

  app.get('/departments', { preHandler: canView }, async () => {
    const departmentList = await employeeService.listDistinctDepartments();
    return { departments: departmentList };
  });
}
