import type { FastifyInstance } from 'fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { EmployeeService } from '../../../services/tools/employee.service.js';
import { employeeParamsSchema } from './schemas.js';
import { prisma } from '../../../lib/prisma.js';

export function registerEmployeeDeleteRoute(app: FastifyInstance, employeeService: EmployeeService): void {
  const canEdit = authorizeRoles('ADMIN', 'MANAGER');

  app.delete('/employees/:id', { preHandler: canEdit, config: { rateLimit: false } }, async (request) => {
    const params = employeeParamsSchema.parse(request.params);
    try {
      // 削除前に未返却の貸出記録の存在を確認
      const activeLoanCount = await prisma.loan.count({
        where: {
          employeeId: params.id,
          returnedAt: null
        }
      });

      if (activeLoanCount > 0) {
        throw new ApiError(400, `この従業員には未返却の貸出記録が${activeLoanCount}件存在するため、削除できません。先にすべての貸出を返却してください。`);
      }

      // 返却済みの貸出記録があっても削除可能（履歴は保持される）
      const employee = await employeeService.delete(params.id);
      return { employee };
    } catch (error) {
      // PrismaのP2025エラー（レコードが見つからない）を404に変換
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, '従業員が見つかりません');
      }
      // P2003エラー（外部キー制約違反）をより分かりやすいメッセージに変換
      // このエラーは通常発生しない（事前チェックで防いでいる）が、念のため処理
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ApiError(400, 'この従業員には貸出記録が存在するため、削除できません。貸出記録は履歴として保持されるため、従業員の削除はできません。');
      }
      // ApiErrorの場合はそのまま再スロー
      if (error instanceof ApiError) {
        throw error;
      }
      throw error;
    }
  });
}

