import type { Prisma, PrismaClient } from '@prisma/client';

export type ScheduleCsvSnapshotDb = Pick<PrismaClient, 'productionScheduleCsvIngestLogicalKeySnapshot'>;
export type ScheduleCsvSnapshotTx = Pick<
  Prisma.TransactionClient,
  'productionScheduleCsvIngestLogicalKeySnapshot'
>;

const CREATE_MANY_CHUNK_SIZE = 500;

/**
 * 生産日程CSV 取込直前に保存した winner 論理キー集合（昇順で安定）。
 */
export async function loadScheduleCsvIngestSnapshotKeys(client: ScheduleCsvSnapshotDb): Promise<string[]> {
  const rows = await client.productionScheduleCsvIngestLogicalKeySnapshot.findMany({
    select: { compositeKey: true },
    orderBy: { compositeKey: 'asc' },
  });
  return rows.map((r) => r.compositeKey);
}

/**
 * スナップショットを全置換する（取込直前または取込完了後）。
 */
export async function replaceScheduleCsvIngestLogicalKeySnapshot(
  tx: ScheduleCsvSnapshotTx,
  keys: readonly string[]
): Promise<void> {
  await tx.productionScheduleCsvIngestLogicalKeySnapshot.deleteMany({});

  for (let i = 0; i < keys.length; i += CREATE_MANY_CHUNK_SIZE) {
    const slice = keys.slice(i, i + CREATE_MANY_CHUNK_SIZE);
    if (slice.length === 0) continue;
    await tx.productionScheduleCsvIngestLogicalKeySnapshot.createMany({
      data: slice.map((compositeKey) => ({ compositeKey })),
    });
  }
}
