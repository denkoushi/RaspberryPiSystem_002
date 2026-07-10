import { Prisma } from '@prisma/client';
import type { Loan } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type LoanTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type LoanTerminalTransition = 'RETURN' | 'CANCEL';

export function activeLoanConflict(message = 'この資産はすでに貸出中です'): ApiError {
  return new ApiError(409, message, undefined, 'ASSET_ALREADY_ON_LOAN');
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function mapActiveLoanCreateError(error: unknown, message?: string): never {
  if (isUniqueConstraintViolation(error)) {
    throw activeLoanConflict(message);
  }
  throw error;
}

export async function createActiveLoan<TArgs extends Prisma.LoanCreateArgs>(
  tx: LoanTransactionClient,
  args: Prisma.SelectSubset<TArgs, Prisma.LoanCreateArgs>,
  conflictMessage?: string,
): Promise<Prisma.LoanGetPayload<TArgs>> {
  try {
    return await tx.loan.create(args);
  } catch (error) {
    mapActiveLoanCreateError(error, conflictMessage);
  }
}

function terminalConflict(loan: Pick<Loan, 'returnedAt' | 'cancelledAt'>, transition: LoanTerminalTransition): ApiError {
  if (loan.returnedAt) {
    return new ApiError(409, 'すでに返却済みです', undefined, 'LOAN_ALREADY_RETURNED');
  }
  if (loan.cancelledAt) {
    return new ApiError(409, 'すでに取消済みです', undefined, 'LOAN_ALREADY_CANCELLED');
  }
  return new ApiError(
    409,
    transition === 'RETURN' ? '貸出状態が変更されたため返却できません' : '貸出状態が変更されたため取消できません',
    undefined,
    'LOAN_STATE_CONFLICT',
  );
}

export async function claimActiveLoanTransition(params: {
  tx: LoanTransactionClient;
  loanId: string;
  transition: LoanTerminalTransition;
  data: Prisma.LoanUncheckedUpdateManyInput;
}): Promise<void> {
  const result = await params.tx.loan.updateMany({
    where: {
      id: params.loanId,
      returnedAt: null,
      cancelledAt: null,
    },
    data: params.data,
  });
  if (result.count === 1) return;

  const current = await params.tx.loan.findUnique({
    where: { id: params.loanId },
    select: { returnedAt: true, cancelledAt: true },
  });
  if (!current) {
    throw new ApiError(404, '貸出レコードが見つかりません');
  }
  throw terminalConflict(current, params.transition);
}
