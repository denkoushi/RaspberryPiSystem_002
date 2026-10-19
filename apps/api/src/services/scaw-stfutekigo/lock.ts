import type { Prisma } from '@prisma/client';

/** Serialize full-snapshot projections across API processes. */
export async function acquireScawStfutekigoSnapshotLock(tx: Pick<Prisma.TransactionClient, '$executeRaw'>): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scaw-stfutekigo-snapshot')::int4)`;
}
