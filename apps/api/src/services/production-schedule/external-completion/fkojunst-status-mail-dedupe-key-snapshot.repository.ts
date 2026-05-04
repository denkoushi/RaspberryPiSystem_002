import type { Prisma, PrismaClient } from '@prisma/client';

export type DedupeSnapshotDb = Pick<
  PrismaClient,
  'productionScheduleFkojunstStatusMailDedupeKeySnapshot'
>;

export type DedupeSnapshotTx = Pick<
  Prisma.TransactionClient,
  'productionScheduleFkojunstStatusMailDedupeKeySnapshot'
>;

const CREATE_MANY_CHUNK_SIZE = 500;

/**
 * 直前の成功同期までに保存された dedupe 済み論理キー（昇順で安定）。
 */
export async function loadPreviousDedupeKeys(client: DedupeSnapshotDb): Promise<string[]> {
  const rows = await client.productionScheduleFkojunstStatusMailDedupeKeySnapshot.findMany({
    select: { compositeKey: true },
    orderBy: { compositeKey: 'asc' },
  });
  return rows.map((r) => r.compositeKey);
}

/**
 * スナップショットを今回のキー集合で全置換する（同一トランザクション推奨）。
 */
export async function replaceDedupeKeySnapshot(tx: DedupeSnapshotTx, keys: readonly string[]): Promise<void> {
  await tx.productionScheduleFkojunstStatusMailDedupeKeySnapshot.deleteMany({});

  for (let i = 0; i < keys.length; i += CREATE_MANY_CHUNK_SIZE) {
    const slice = keys.slice(i, i + CREATE_MANY_CHUNK_SIZE);
    if (slice.length === 0) {
      continue;
    }
    await tx.productionScheduleFkojunstStatusMailDedupeKeySnapshot.createMany({
      data: slice.map((compositeKey) => ({ compositeKey })),
    });
  }
}
