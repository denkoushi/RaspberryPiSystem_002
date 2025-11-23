import type { Loan } from '@prisma/client';
import { ItemStatus, TransactionAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { ItemService } from './item.service.js';
import { EmployeeService } from './employee.service.js';

export interface BorrowInput {
  itemTagUid: string;
  employeeTagUid: string;
  clientId?: string;
  dueAt?: Date;
  note?: string | null;
}

export interface ReturnInput {
  loanId: string;
  clientId?: string;
  performedByUserId?: string;
  note?: string | null;
}

export interface ActiveLoanQuery {
  clientId?: string;
}

interface LoanWithRelations extends Loan {
  item: { id: string; itemCode: string; name: string; nfcTagUid: string | null };
  employee: { id: string; employeeCode: string; displayName: string; nfcTagUid: string | null };
  client?: { id: string; name: string; location: string | null } | null;
}

export class LoanService {
  private itemService: ItemService;
  private employeeService: EmployeeService;

  constructor() {
    this.itemService = new ItemService();
    this.employeeService = new EmployeeService();
  }

  /**
   * クライアントIDを解決（clientIdまたはx-client-keyヘッダーから）
   */
  async resolveClientId(
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

  /**
   * 持出処理
   */
  async borrow(input: BorrowInput, resolvedClientId?: string): Promise<LoanWithRelations> {
    logger.info(
      {
        itemTagUid: input.itemTagUid,
        employeeTagUid: input.employeeTagUid,
        clientId: resolvedClientId,
      },
      'Borrow request started',
    );

    const item = await this.itemService.findByNfcTagUid(input.itemTagUid);
    if (!item) {
      logger.warn({ itemTagUid: input.itemTagUid }, 'Item not found for borrow');
      throw new ApiError(404, '対象アイテムが登録されていません');
    }
    if (item.status === ItemStatus.RETIRED) {
      logger.warn({ itemId: item.id, status: item.status }, 'Retired item borrow attempt');
      throw new ApiError(400, '廃棄済みアイテムは持出できません');
    }

    const employee = await this.employeeService.findByNfcTagUid(input.employeeTagUid);
    if (!employee) {
      logger.warn({ employeeTagUid: input.employeeTagUid }, 'Employee not found for borrow');
      throw new ApiError(404, '対象従業員が登録されていません');
    }

    const existingLoan = await prisma.loan.findFirst({
      where: { itemId: item.id, returnedAt: null }
    });
    if (existingLoan) {
      logger.warn(
        {
          itemId: item.id,
          existingLoanId: existingLoan.id,
        },
        'Item already on loan',
      );
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
          dueAt: input.dueAt,
          notes: input.note ?? undefined
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
            note: input.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return createdLoan;
    });

    logger.info(
      {
        loanId: loan.id,
        itemId: item.id,
        itemCode: item.itemCode,
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        clientId: resolvedClientId,
      },
      'Borrow completed successfully',
    );

    return loan as LoanWithRelations;
  }

  /**
   * 返却処理
   */
  async return(
    input: ReturnInput,
    resolvedClientId?: string,
    performedByUserId?: string
  ): Promise<LoanWithRelations> {
    logger.info(
      {
        loanId: input.loanId,
        clientId: resolvedClientId,
        performedByUserId: performedByUserId ?? input.performedByUserId,
      },
      'Return request started',
    );

    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      include: { item: true, employee: true }
    });
    if (!loan) {
      logger.warn({ loanId: input.loanId }, 'Loan not found for return');
      throw new ApiError(404, '貸出レコードが見つかりません');
    }
    if (loan.returnedAt) {
      logger.warn({ loanId: loan.id, returnedAt: loan.returnedAt }, 'Loan already returned');
      throw new ApiError(400, 'すでに返却済みです');
    }

    const finalPerformedByUserId = performedByUserId ?? input.performedByUserId;
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
          notes: input.note ?? loan.notes ?? undefined
        },
        include: { item: true, employee: true, client: true }
      });

      await tx.item.update({ where: { id: loan.itemId }, data: { status: ItemStatus.AVAILABLE } });

      await tx.transaction.create({
        data: {
          loanId: loan.id,
          action: TransactionAction.RETURN,
          actorEmployeeId: loan.employeeId,
          performedByUserId: finalPerformedByUserId,
          clientId: resolvedClientId ?? loan.clientId,
          details: {
            note: input.note ?? null,
            itemSnapshot,
            employeeSnapshot
          }
        }
      });

      return loanResult;
    });

    logger.info(
      {
        loanId: updatedLoan.id,
        itemId: updatedLoan.itemId,
        employeeId: updatedLoan.employeeId,
        clientId: resolvedClientId ?? loan.clientId,
        returnedAt: updatedLoan.returnedAt,
      },
      'Return completed successfully',
    );

    return updatedLoan as LoanWithRelations;
  }

  /**
   * アクティブな貸出一覧を取得
   */
  async findActive(query: ActiveLoanQuery): Promise<LoanWithRelations[]> {
    const where = {
      returnedAt: null,
      ...(query.clientId ? { clientId: query.clientId } : {})
    };

    const loans = await prisma.loan.findMany({
      where,
      include: { item: true, employee: true, client: true },
      orderBy: { borrowedAt: 'desc' }
    });

    return loans as LoanWithRelations[];
  }
}

