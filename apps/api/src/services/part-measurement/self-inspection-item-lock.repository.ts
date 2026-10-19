import type { Prisma } from '@prisma/client';

/** 未開始を含む同一自主検査アイテムの開始・削除・再作成を直列化する。 */
export async function lockSelfInspectionItemBusinessKey(
  db: Prisma.TransactionClient,
  itemBusinessKey: string
): Promise<void> {
  await db.$queryRaw<{ locked: string }[]>`
    SELECT pg_advisory_xact_lock(hashtextextended(${itemBusinessKey}, 0))::text AS "locked"
  `;
}
