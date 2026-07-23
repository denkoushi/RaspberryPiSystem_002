import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

export async function lockTorqueWrenchProfile(
  tx: Prisma.TransactionClient,
  torqueWrenchProfileId: string
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "TorqueWrenchProfile"
    WHERE "id" = ${torqueWrenchProfileId}
    FOR UPDATE
  `);
  if (rows.length === 0) {
    throw new ApiError(404, '物理トルクレンチが見つかりません');
  }
}
