import type { PrismaClient } from '@prisma/client';

/**
 * 指定した Loan ID のうち、取消済み（`cancelledAt` あり）のものだけを返す。
 * `loanIds` が空のときは DB を呼ばない。
 */
export async function loadCancelledLoanIdSet(
  prisma: Pick<PrismaClient, 'loan'>,
  loanIds: readonly string[],
): Promise<Set<string>> {
  if (loanIds.length === 0) {
    return new Set();
  }
  const uniqueIds = Array.from(new Set(loanIds));
  const rows = await prisma.loan.findMany({
    where: {
      id: { in: uniqueIds },
      cancelledAt: { not: null },
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
