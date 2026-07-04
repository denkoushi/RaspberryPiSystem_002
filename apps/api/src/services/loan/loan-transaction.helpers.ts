import type { Loan, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

type TransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

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
  setAssetInUse: (tx: TransactionClient) => Promise<unknown>;
  buildTransactionCreateData: (
    createdLoan: TLoan,
  ) => Prisma.TransactionUncheckedCreateInput;
}): Promise<TLoan> {
  return prisma.$transaction(async (tx) => {
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
}

export async function executeAssetReturnTransaction<TLoan>(params: {
  loanId: string;
  loanUpdate: {
    data: { returnedAt: Date; notes?: string };
    include: Prisma.LoanInclude;
  };
  assetId: string | null;
  setAssetAvailable: (tx: TransactionClient, assetId: string) => Promise<unknown>;
  transactionCreate: Prisma.TransactionUncheckedCreateInput;
}): Promise<TLoan> {
  return prisma.$transaction(async (tx) => {
    const result = (await tx.loan.update({
      where: { id: params.loanId },
      data: params.loanUpdate.data,
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
