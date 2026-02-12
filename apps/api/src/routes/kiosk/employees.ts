import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma.js';

type EmployeesRouteDeps = {
  requireClientDevice: (rawClientKey: unknown) => Promise<unknown>;
};

export async function registerKioskEmployeesRoute(
  app: FastifyInstance,
  deps: EmployeesRouteDeps
): Promise<void> {
  // キオスク専用の従業員リスト取得エンドポイント（x-client-key認証のみ）
  app.get('/kiosk/employees', { config: { rateLimit: false } }, async (request) => {
    const rawClientKey = request.headers['x-client-key'];
    await deps.requireClientDevice(rawClientKey);

    // アクティブな従業員のみを取得（基本情報のみ）
    const employees = await prisma.employee.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        displayName: true,
        department: true
      },
      orderBy: {
        displayName: 'asc'
      }
    });

    return { employees };
  });
}
