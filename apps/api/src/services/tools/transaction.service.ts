import type { Prisma, Transaction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export interface TransactionQuery {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  itemId?: string;
  clientId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface TransactionWithRelations extends Transaction {
  loan: {
    id: string;
    item: { id: string; itemCode: string; name: string; nfcTagUid: string | null };
    employee: { id: string; employeeCode: string; displayName: string; nfcTagUid: string | null };
    client?: { id: string; name: string; location: string | null } | null;
  };
  actorEmployee: { id: string; employeeCode: string; displayName: string } | null;
  performedByUser: { id: string; username: string } | null;
  client?: { id: string; name: string; location: string | null } | null;
}

export interface TransactionListResult {
  transactions: TransactionWithRelations[];
  total: number;
  page: number;
  pageSize: number;
}

export class TransactionService {
  /**
   * トランザクション一覧を取得（ページネーション対応）
   */
  async findAll(query: TransactionQuery): Promise<TransactionListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.TransactionWhereInput = {
      ...(query.employeeId ? { actorEmployeeId: query.employeeId } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.itemId
        ? {
            loan: {
              itemId: query.itemId
            }
          }
        : {}),
      ...(query.startDate || query.endDate
        ? {
            createdAt: {
              ...(query.startDate ? { gte: query.startDate } : {}),
              ...(query.endDate ? { lte: query.endDate } : {})
            }
          }
        : {})
    };

    const [total, transactions] = await prisma.$transaction([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          loan: {
            include: { item: true, employee: true, client: true }
          },
          actorEmployee: true,
          performedByUser: true,
          client: true
        }
      })
    ]);

    return {
      transactions: transactions as TransactionWithRelations[],
      total,
      page,
      pageSize
    };
  }
}

