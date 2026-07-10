import type { Loan, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  claimActiveLoanTransition,
  mapActiveLoanCreateError,
  type LoanTransactionClient,
} from './loan-concurrency.js';

type ActiveLoanAssetFkField = 'measuringInstrumentId' | 'riggingGearId';

export async function findActiveLoanForAsset(params: {
  assetFkField: ActiveLoanAssetFkField;
  assetId: string;
}): Promise<Loan | null> {
  return prisma.loan.findFirst({
    where: {
      [params.assetFkField]: params.assetId,
      returnedAt: null,
      cancelledAt: null,
    },
  });
}

export async function executeAssetBorrowTransaction<TLoan extends { id: string }>(params: {
  loanCreate: {
    data: Prisma.LoanUncheckedCreateInput;
    include: Prisma.LoanInclude;
  };
  setAssetInUse: (tx: LoanTransactionClient) => Promise<unknown>;
  buildTransactionCreateData: (
    createdLoan: TLoan,
  ) => Prisma.TransactionUncheckedCreateInput;
}): Promise<TLoan> {
  try {
    return await prisma.$transaction(async (tx) => {
      const createdLoan = (await tx.loan.create({
        data: params.loanCreate.data,
        include: params.loanCreate.include,
      })) as unknown as TLoan;

      await params.setAssetInUse(tx);

      await tx.transaction.create({
        data: params.buildTransactionCreateData(createdLoan),
      });

      return createdLoan;
    });
  } catch (error) {
    mapActiveLoanCreateError(error);
  }
}

export async function executeAssetReturnTransaction<TLoan>(params: {
  loanId: string;
  loanUpdate: {
    data: { returnedAt: Date; notes?: string };
    include: Prisma.LoanInclude;
  };
  assetId: string | null;
  setAssetAvailable: (tx: LoanTransactionClient, assetId: string) => Promise<unknown>;
  transactionCreate: Prisma.TransactionUncheckedCreateInput;
}): Promise<TLoan> {
  return prisma.$transaction(async (tx) => {
    await claimActiveLoanTransition({
      tx,
      loanId: params.loanId,
      transition: 'RETURN',
      data: params.loanUpdate.data,
    });

    const result = (await tx.loan.findUniqueOrThrow({
      where: { id: params.loanId },
      include: params.loanUpdate.include,
    })) as unknown as TLoan;

    if (params.assetId) {
      await params.setAssetAvailable(tx, params.assetId);
    }

    await tx.transaction.create({
      data: params.transactionCreate,
    });

    return result;
  });
}
