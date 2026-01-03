import type { FastifyInstance } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';

/**
 * 部署一覧取得エンドポイント
 * 従業員マスターのdepartmentフィールドから重複を除いた部署一覧を返す
 */
export function registerDepartmentsRoute(app: FastifyInstance): void {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.get('/departments', { preHandler: canView }, async () => {
    // Employee.departmentのdistinct値を取得（nullと空文字を除外）
    const employees = await prisma.employee.findMany({
      select: {
        department: true
      },
      where: {
        AND: [
          { department: { not: null } },
          { department: { not: '' } }
        ]
      }
    });

    // departmentフィールドの値のみを抽出し、重複を除去してソート
    const departmentSet = new Set<string>();
    employees.forEach((emp) => {
      if (emp.department && emp.department.trim() !== '') {
        departmentSet.add(emp.department);
      }
    });

    const departmentList = Array.from(departmentSet).sort();

    return { departments: departmentList };
  });
}

