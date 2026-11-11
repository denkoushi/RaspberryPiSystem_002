import type { Prisma } from '@prisma/client';

export async function deleteEmptyRowNote(tx: Prisma.TransactionClient, rowId: string): Promise<void> {
  // Due-date cancellation can retain whitespace notes; match String.trim() for both callers.
  const trimCharacters = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  await tx.$executeRaw`
    DELETE FROM "ProductionScheduleRowNote"
    WHERE "csvDashboardRowId" = ${rowId}
      AND NULLIF(BTRIM("note", ${trimCharacters}), '') IS NULL
      AND "dueDate" IS NULL
      AND NULLIF(BTRIM("processingType", ${trimCharacters}), '') IS NULL
  `;
}
