import { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const PALLET_COMMAND_LOCK_NAMESPACE = 70422001;

export type PalletTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export async function acquirePalletCommandLock(
  tx: PalletTransactionClient,
  resourceCd: string,
  palletNo: number,
): Promise<void> {
  const key = `${resourceCd.trim().toUpperCase()}:${palletNo}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${PALLET_COMMAND_LOCK_NAMESPACE}::int4, hashtext(${key}::text)::int4)
  `;
}

export function mapPalletOrderConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ApiError(409, '同じパレットの表示順が競合しました', undefined, 'PALLET_ORDER_CONFLICT');
  }
  throw error;
}

