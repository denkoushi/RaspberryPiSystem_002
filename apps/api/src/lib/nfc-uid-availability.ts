import type { Prisma, PrismaClient } from '@prisma/client';

import { ApiError } from './errors.js';

/**
 * Inventory NFC tags share the same physical UID namespace as employee and
 * master-item tags. Keep the reverse-direction check here so creating or
 * editing a master record cannot claim an already registered inventory tag.
 */
export async function assertInventoryNfcUidAvailable(
  uid: string,
  db: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const inventoryTag = await db.inventoryNfcTag.findFirst({ where: { uid }, select: { id: true } });
  if (inventoryTag) {
    throw new ApiError(409, 'このUIDは在庫管理のNFCタグで使用中です');
  }
}
