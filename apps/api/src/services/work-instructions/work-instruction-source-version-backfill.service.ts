import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { ensureWorkInstructionPublicationForRow } from './repositories/prisma-work-instruction-version.persistence.js';

const sourceRowInclude = {
  steps: {
    orderBy: { step: 'asc' as const },
    include: { asset: true }
  }
} as const;

export type WorkInstructionSourceVersionBackfillResult = {
  scanned: number;
  created: number;
  alreadyPresent: number;
  raced: number;
};

export type WorkInstructionSourceVersionBackfillOptions = {
  batchSize?: number;
  now?: () => Date;
};

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Creates the immutable source-version/publication sidecars for legacy rows.
 *
 * The row list is paged by id, while every row is handled in its own
 * transaction.  Consequently a large import does not hold one transaction
 * open for the entire table and a failed row can be retried independently.
 * The publication unique key makes repeated runs idempotent; a concurrent
 * importer/backfill may win that key, which is reported as `raced` and is
 * safe to retry on a later run.
 */
export async function backfillWorkInstructionSourceVersions(
  db: PrismaClient = defaultPrisma,
  options: WorkInstructionSourceVersionBackfillOptions = {}
): Promise<WorkInstructionSourceVersionBackfillResult> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > 1_000) {
    throw new Error('batchSize must be an integer between 1 and 1000');
  }
  const now = options.now ?? (() => new Date());
  let cursor: string | undefined;
  const result: WorkInstructionSourceVersionBackfillResult = {
    scanned: 0,
    created: 0,
    alreadyPresent: 0,
    raced: 0
  };

  let hasMore = true;
  while (hasMore) {
    const rows = await db.workInstructionRow.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true }
    });
    if (rows.length === 0) break;
    hasMore = rows.length === batchSize;
    result.scanned += rows.length;

    for (const row of rows) {
      cursor = row.id;
      try {
        // Deliberately one row per transaction.  This also makes a rerun
        // converge when an individual legacy row contains malformed data.
        const created = await db.$transaction(async (tx) => {
          const existing = await tx.workInstructionSourcePublication.findUnique({ where: { rowId: row.id } });
          if (existing) return false;
          const sourceRow = await tx.workInstructionRow.findUnique({
            where: { id: row.id },
            include: sourceRowInclude
          });
          if (!sourceRow) return false;
          await ensureWorkInstructionPublicationForRow(tx, sourceRow, now());
          return true;
        });
        if (created) result.created += 1;
        else result.alreadyPresent += 1;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        // An importer or another backfill transaction created the sidecar
        // after our initial read.  No partial data is retained because the
        // transaction rolled back; a future run can verify it idempotently.
        result.raced += 1;
      }
    }
  }

  return result;
}
