import type { Prisma } from '@prisma/client';

/** 組立テンプレート系譜専用のtransaction advisory-lock namespace。 */
export const ASSEMBLY_TEMPLATE_LINEAGE_LOCK_NS = 824_002;

export function buildAssemblyTemplateLineageKey(modelCode: string, procedurePattern: string): string {
  return `${modelCode.trim().toUpperCase()}|${procedurePattern.trim().toUpperCase()}`;
}

/** 同一型番・手順パターンの版採番とactive切替を直列化する。 */
export async function acquireAssemblyTemplateLineageTransactionLock(
  tx: Prisma.TransactionClient,
  modelCode: string,
  procedurePattern: string
): Promise<void> {
  const lineageKey = buildAssemblyTemplateLineageKey(modelCode, procedurePattern);
  await tx.$queryRaw<Array<{ acquired: number }>>`
    SELECT 1::int4 AS acquired
    FROM (
      SELECT pg_advisory_xact_lock(
        ${ASSEMBLY_TEMPLATE_LINEAGE_LOCK_NS}::int4,
        hashtext(${lineageKey}::text)::int4
      )
    ) AS lock_wait
  `;
}
