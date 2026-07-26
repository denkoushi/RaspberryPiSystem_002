import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

/** 組立ロット製番専用のtransaction advisory-lock namespace。 */
export const ASSEMBLY_LOT_PRODUCT_LOCK_NAMESPACE = 0x41534d4c;

export async function lockAssemblyLotProduct(
  tx: AssemblyTransactionClient,
  normalizedProductNo: string
): Promise<void> {
  // pg_advisory_xact_lockはvoidを返すため、Prismaでは$executeRawを使う。
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${ASSEMBLY_LOT_PRODUCT_LOCK_NAMESPACE}::int4,
      hashtext(${normalizedProductNo}::text)::int4
    )
  `;
}

