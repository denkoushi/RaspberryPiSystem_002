import type { FastifyInstance } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeParamsSchema } from './schemas.js';

export function registerEmployeeDeleteRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.delete('/employees/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const params = employeeParamsSchema.parse(request.params);
    try {
      const employee = await employeeService.delete(params.id);
      return { employee };
    } catch (error) {
      // PrismaのP2025エラー（レコードが見つからない）を404に変換
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, '従業員が見つかりません');
      }
      throw error;
    }
  });
}

