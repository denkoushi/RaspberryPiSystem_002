import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import pkg from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { authorizeRoles } from '../lib/auth.js';

const { ItemStatus, TransactionAction } = pkg;

const borrowSchema = z.object({
  itemTagUid: z.string().min(4),
  employeeTagUid: z.string().min(4),
  clientId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional().nullable()
});

const returnSchema = z.object({
  loanId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  performedByUserId: z.string().uuid().optional(),
  note: z.string().optional().nullable()
});

const activeLoanQuerySchema = z.object({
  clientId: z.string().uuid().optional()
});

async function resolveClientId(
  clientId: string | undefined,
  apiKeyHeader: string | string[] | undefined
): Promise<string | undefined> {
  if (clientId) {
    const client = await prisma.clientDevice.findUnique({ where: { id: clientId } });
    if (!client) {
      throw new ApiError(404, '指定されたクライアントが存在しません');
    }
    return client.id;
  }
  if (typeof apiKeyHeader === 'string') {
    const client = await prisma.clientDevice.findUnique({ where: { apiKey: apiKeyHeader } });
    if (!client) {
      throw new ApiError(401, 'クライアント API キーが不正です');
    }
    return client.id;
  }
  return undefined;
}

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');

  app.post('/borrow', async (request) => {
    const body = borrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await resolveClientId(body.clientId, headerKey);

    const item = await prisma.item.findFirst({ where: { nfcTagUid: body.itemTagUid } });
    if (!item) {
      throw new ApiError(404, '対象アイテムが登録されていません');
    }
    if (item.status === ItemStatus.RETIRED) {
      throw new ApiError(400, '廃棄済みアイテムは持出できません');
    }

    const employee = await prisma.employee.findFirst({ where: { nfcTagUid: body.employeeTagUid } });
    if (!employee) {
      throw new ApiError(404, '対象従業員が登録されていません');
    }

    const existingLoan = await prisma.loan.findFirst({
      where: { itemId: item.id, returnedAt: null }
    });
    if (existingLoan) {
      throw new ApiError(400, 'このアイテムはすでに貸出中です');
    }

    const itemSnapshot = {
      id: item.id,
      code: item.itemCode,
      name: item.name,
      nfcTagUid: item.nfcTagUid ?? null
    };
    const employeeSnapshot = {
      id: employee.id,
      code: employee.employeeCode,
      name: employee.displayName,
      nfcTagUid: employee.nfcTagUid ?? null
    };

    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          itemId: item.id,
          employeeId: employee.id,
          clientId: resolvedClientId,
          dueAt: body.dueAt,
          notes: body.note ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      await tx.item.update({ where: { id: item.id }, data: { status: ItemStatus.IN_USE } });

      await tx.transaction.create({
        data: {
          loanId: createdLoan.id,
          action: TransactionAction.BORROW,
          actorEmployeeId: employee.id,
          clientId: resolvedClientId,
          details: {
            note: body.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return createdLoan;
    });

    return { loan };
  });

  app.post('/return', async (request) => {
    const body = returnSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await resolveClientId(body.clientId, headerKey);

    const loan = await prisma.loan.findUnique({
      where: { id: body.loanId },
      include: { item: true, employee: true }
    });
    if (!loan) {
      throw new ApiError(404, '貸出レコードが見つかりません');
    }
    if (loan.returnedAt) {
      throw new ApiError(400, 'すでに返却済みです');
    }

    const performedByUserId = request.user?.id ?? body.performedByUserId;
    const itemSnapshot = {
      id: loan.item.id,
      code: loan.item.itemCode,
      name: loan.item.name,
      nfcTagUid: loan.item.nfcTagUid ?? null
    };
    const employeeSnapshot = {
      id: loan.employee.id,
      code: loan.employee.employeeCode,
      name: loan.employee.displayName,
      nfcTagUid: loan.employee.nfcTagUid ?? null
    };

    const updatedLoan = await prisma.$transaction(async (tx) => {
      const loanResult = await tx.loan.update({
        where: { id: loan.id },
        data: {
          returnedAt: new Date(),
          clientId: resolvedClientId ?? loan.clientId,
          notes: body.note ?? loan.notes ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      await tx.item.update({ where: { id: loan.itemId }, data: { status: ItemStatus.AVAILABLE } });

      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.RETURN,
          actorEmployeeId: loan.employeeId,
          performedByUserId,
          clientId: resolvedClientId ?? loan.clientId,
          details: {
            note: body.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return loanResult;
    });

    return { loan: updatedLoan };
  });

  app.get('/loans/active', async (request, reply) => {
    const query = activeLoanQuerySchema.parse(request.query);
    let resolvedClientId = query.clientId;
    let allowWithoutAuth = false;

    // クライアントキーがあれば優先的にデバイス認証とみなす
    const headerKey = request.headers['x-client-key'];
    if (headerKey) {
      resolvedClientId = await resolveClientId(resolvedClientId, headerKey);
      allowWithoutAuth = true;
    } else {
      try {
        await canView(request, reply);
      } catch (error) {
        // JWT が無効でも clientId が明示されていれば許可する
        if (!resolvedClientId) {
          throw error;
        }
      }
    }

    const where = {
      returnedAt: null,
      ...(resolvedClientId ? { clientId: resolvedClientId } : {})
    };

    const loans = await prisma.loan.findMany({
      where,
      include: { item: true, employee: true, client: true },
      orderBy: { borrowedAt: 'desc' }
    });

    if (allowWithoutAuth) {
      return { loans: loans.filter((loan) => loan.clientId === resolvedClientId) };
    }
    return { loans };
  });
}
