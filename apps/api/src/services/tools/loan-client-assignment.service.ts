import { TransactionAction, type Loan } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

type LoanWithRelations = Loan & {
  item: { id: string; itemCode: string; name: string; nfcTagUid: string | null } | null;
  measuringInstrument?: { id: string; managementNumber: string; name: string } | null;
  riggingGear?: { id: string; managementNumber: string; name: string; idNum?: string | null } | null;
  employee: { id: string; employeeCode: string; displayName: string; nfcTagUid: string | null } | null;
  client?: { id: string; name: string; location: string | null } | null;
};

export interface AssignLoanClientInput {
  loanId: string;
  clientId: string;
  performedByUserId?: string;
}

export class LoanClientAssignmentService {
  async assignClientToActiveLoan(input: AssignLoanClientInput): Promise<LoanWithRelations> {
    const loan = await prisma.loan.findUnique({
      where: { id: input.loanId },
      include: { item: true, measuringInstrument: true, riggingGear: true, employee: true, client: true },
    });
    if (!loan) {
      throw new ApiError(404, '貸出レコードが見つかりません');
    }
    if (loan.returnedAt || loan.cancelledAt) {
      throw new ApiError(400, '未返却かつ未取消の貸出のみ端末を再紐付けできます');
    }

    const client = await prisma.clientDevice.findUnique({ where: { id: input.clientId } });
    if (!client) {
      throw new ApiError(404, '指定されたクライアントが存在しません');
    }

    if (loan.clientId && loan.clientId !== input.clientId) {
      throw new ApiError(409, 'この貸出にはすでに別のクライアントが紐付いています');
    }

    if (loan.clientId === input.clientId) {
      return loan as LoanWithRelations;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedLoan = await tx.loan.update({
        where: { id: input.loanId },
        data: { clientId: input.clientId },
        include: { item: true, measuringInstrument: true, riggingGear: true, employee: true, client: true },
      });

      // 過去データ補正時は BORROW 履歴にも同じ clientId を埋めて監査情報を揃える。
      await tx.transaction.updateMany({
        where: {
          loanId: input.loanId,
          action: TransactionAction.BORROW,
          clientId: null,
        },
        data: {
          clientId: input.clientId,
        },
      });

      await tx.transaction.create({
        data: {
          loanId: input.loanId,
          action: TransactionAction.ADJUST,
          actorEmployeeId: updatedLoan.employeeId ?? undefined,
          performedByUserId: input.performedByUserId,
          clientId: input.clientId,
          details: {
            reason: 'MANUAL_CLIENT_ASSIGNMENT',
            previousClientId: loan.clientId ?? null,
            newClientId: input.clientId,
          },
        },
      });

      return updatedLoan;
    });

    return updated as LoanWithRelations;
  }
}
