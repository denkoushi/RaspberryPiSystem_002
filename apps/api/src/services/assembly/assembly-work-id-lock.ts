import type { AssemblyTransactionClient } from './assembly-work-session-lock.repository.js';

/** ロット外を含む作業用ID開始処理専用のtransaction advisory-lock namespace。 */
export const ASSEMBLY_WORK_ID_LOCK_NAMESPACE = 0x41534d57;

/** 未登録WorkUnitの同時作成も含め、同一作業用IDの開始を直列化する。 */
export async function lockAssemblyWorkId(
  tx: AssemblyTransactionClient,
  normalizedWorkId: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${ASSEMBLY_WORK_ID_LOCK_NAMESPACE}::int4,
      hashtext(${normalizedWorkId}::text)::int4
    )
  `;
}
