import { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';

/**
 * Deferred existing-row update for FKOJUNST_Status mail ingest.
 * Content and source publication are applied together inside the locked completion
 * transaction so a failed ingest never exposes new row content under a prior COMPLETED
 * source run, and never hides rows behind a PROCESSING/FAILED sourceIngestRunId.
 */
export type FkojunstDeferredRowUpdate = {
  id: string;
  occurredAt: Date;
  rowData: Prisma.InputJsonValue;
  sourceIngestRunId: string;
  sourceRowOrdinal: number;
  sourceIngestRunStartedAt: Date;
};

export const FKOJUNST_STATUS_MAIL_DEFERRED_ROW_UPDATE_BATCH_SIZE = 250;
export const FKOJUNST_STATUS_MAIL_COMPLETION_TX_TIMEOUT_MS = 180_000;
export const FKOJUNST_STATUS_MAIL_TX_MAX_WAIT_MS = 15_000;

type FkojunstDeferredRowUpdateTransaction = Pick<Prisma.TransactionClient, '$executeRaw'>;

function buildDeferredRowUpdateValuesSql(updates: FkojunstDeferredRowUpdate[]): Prisma.Sql {
  return Prisma.join(
    updates.map(
      (update) =>
        Prisma.sql`(
          ${update.id},
          ${update.occurredAt},
          ${JSON.stringify(update.rowData)}::jsonb,
          ${update.sourceIngestRunId},
          ${update.sourceRowOrdinal},
          ${update.sourceIngestRunStartedAt}
        )`
    ),
    ','
  );
}

/**
 * Atomically publishes deferred row content and source metadata inside the completion tx.
 * Uses batched UPDATE ... FROM (VALUES ...) to avoid N sequential round trips under the lock.
 */
export async function applyFkojunstDeferredRowUpdatesInTransaction(
  tx: FkojunstDeferredRowUpdateTransaction,
  updates: FkojunstDeferredRowUpdate[]
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  const startedAt = Date.now();
  const batchSize = FKOJUNST_STATUS_MAIL_DEFERRED_ROW_UPDATE_BATCH_SIZE;
  let batchesExecuted = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const valuesSql = buildDeferredRowUpdateValuesSql(batch);

    const affected = await tx.$executeRaw<number>`
      UPDATE "CsvDashboardRow" AS r
      SET
        "occurredAt" = v.occurred_at,
        "rowData" = v.row_data,
        "sourceIngestRunId" = v.source_ingest_run_id,
        "sourceRowOrdinal" = v.source_row_ordinal,
        "sourceIngestRunStartedAt" = v.source_ingest_run_started_at,
        "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${valuesSql}) AS v(
        id,
        occurred_at,
        row_data,
        source_ingest_run_id,
        source_row_ordinal,
        source_ingest_run_started_at
      )
      WHERE r."id" = v.id
    `;
    const affectedCount = typeof affected === 'number' ? affected : 0;
    if (affectedCount !== batch.length) {
      throw new Error(
        `[FkojunstStatusMailIngestPublication] deferred row update count mismatch: expected ${batch.length}, got ${affectedCount}`
      );
    }
    batchesExecuted += 1;
  }

  logger.info(
    {
      totalUpdates: updates.length,
      batchSize,
      batchesExecuted,
      durationMs: Date.now() - startedAt,
    },
    '[FkojunstStatusMailIngestPublication] deferred row updates completed'
  );
}
