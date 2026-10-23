/**
 * 棚マスタの全削除。既定は dry-run。
 * pnpm --filter @raspi-system/api delete:mobile-placement-shelves
 * pnpm --filter @raspi-system/api delete:mobile-placement-shelves -- --execute --confirm=DELETE-ALL-SHELVES
 * 本番コンテナ: node dist/scripts/delete-all-mobile-placement-shelves.js（引数は同じ）
 */
import { pathToFileURL } from 'node:url';

import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma.js';

async function summarize(db: Prisma.TransactionClient) {
  const shelves = await db.mobilePlacementShelf.findMany({
    select: { shelfCodeRaw: true }, orderBy: { shelfCodeRaw: 'asc' }
  });
  const photoCount = await db.mobilePlacementShelfPhoto.count();
  const layoutEntities = await db.mobilePlacementLayoutEntity.findMany({
    where: { OR: [{ shelfId: { not: null } }, { entityKind: 'SHELF' }] },
    select: { id: true, zoneLayoutId: true, entityKind: true, shelfId: true, shelf: { select: { shelfCodeRaw: true } } },
    orderBy: { id: 'asc' }
  });
  const clientDevices = await db.clientDevice.findMany({
    where: { haizenPresetShelfCodeRaw: { not: null } },
    select: { id: true, name: true, haizenPresetShelfCodeRaw: true },
    orderBy: { id: 'asc' }
  });
  return {
    shelfCount: shelves.length, shelfCodes: shelves.map((s) => s.shelfCodeRaw), photoCount,
    layoutEntityCount: layoutEntities.length, layoutEntities,
    clientDeviceCount: clientDevices.length, clientDevices
  };
}

export async function deleteAllMobilePlacementShelves(args: string[]) {
  const execute = args.includes('--execute');
  const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
  if (execute && confirmation !== 'DELETE-ALL-SHELVES') {
    throw new Error('実削除には --execute --confirm=DELETE-ALL-SHELVES を同時に指定してください');
  }
  if (!execute) return { mode: 'dry-run', before: await summarize(prisma) };

  return prisma.$transaction(async (tx) => {
    const before = await summarize(tx);
    await tx.clientDevice.updateMany({
      where: { haizenPresetShelfCodeRaw: { not: null } },
      data: { haizenPresetShelfCodeRaw: null }
    });
    // Shelf cells become unused so saving a zone does not hit the "no new shelves" rule.
    await tx.mobilePlacementLayoutEntity.updateMany({
      where: { entityKind: 'SHELF' },
      data: { entityKind: 'UNUSED', shelfId: null }
    });
    // Photos cascade. Placement events/current placements and nextShelfSlot remain untouched.
    await tx.mobilePlacementShelf.deleteMany({});
    return { mode: 'execute', before, after: await summarize(tx) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void deleteAllMobilePlacementShelves(process.argv.slice(2))
    .then((result) => { console.log(JSON.stringify(result, null, 2)); })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect().catch(() => { /* ignore */ }));
}
