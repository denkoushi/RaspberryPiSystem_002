import type { Prisma } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';

export async function lockPartMeasurementSheetRow(
  tx: Prisma.TransactionClient,
  sheetId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "PartMeasurementSheet" WHERE id = ${sheetId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ApiError(404, '記録表が見つかりません');
  }
}
