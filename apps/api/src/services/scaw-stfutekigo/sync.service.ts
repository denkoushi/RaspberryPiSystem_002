import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { acquireScawStfutekigoSnapshotLock } from './lock.js';
import { loadScawStfutekigoStagingRows, deleteScawStfutekigoStagingRows } from './repository.js';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from './constants.js';
import { ProductionScheduleScawStfutekigoEnrichmentAdapter } from './production-schedule-enrichment.adapter.js';
import { normalizeScawStfutekigoRows } from './normalizer.js';
import type { ScawStfutekigoEnrichmentAdapter as EnrichmentAdapter } from './enrichment.js';
import type { ScawStfutekigoEnrichment, ScawStfutekigoNormalizedRow, ScawStfutekigoSyncResult } from './types.js';

const CLEANUP_CHUNK_SIZE = 500;
const SYNC_TX_TIMEOUT_MS = 120_000;
const SYNC_TX_MAX_WAIT_MS = 30_000;
const WRITE_CHUNK_SIZE = 500;

type IngestRun = {
  id: string;
  csvDashboardId: string;
  status: string;
  startedAt: Date;
  sourceReceivedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  rowsProcessed: number;
};

function noEnrichment(): ScawStfutekigoEnrichment {
  return {
    partNumber: null,
    partName: null,
    machineName: null,
    resolvedSeiban: null,
    enrichmentStatus: 'NOT_FOUND',
    enrichedAt: null,
  };
}

function domainFields(row: ScawStfutekigoNormalizedRow, enrichment: ScawStfutekigoEnrichment) {
  return {
    nonconformityNo: row.nonconformityNo,
    originDepartmentCode: row.originDepartmentCode,
    originDepartmentName: row.originDepartmentName,
    quantity: row.quantity,
    remarks: row.remarks,
    nonconformityContent: row.nonconformityContent,
    correctiveContent1: row.correctiveContent1,
    correctiveContent2: row.correctiveContent2,
    dispositionContent: row.dispositionContent,
    discoveredOn: row.discoveredOn,
    sourceUpdatedOn: row.sourceUpdatedOn,
    manufacturingOrderNo: row.manufacturingOrderNo,
    sourceSeiban: row.sourceSeiban,
    resolvedSeiban: enrichment.resolvedSeiban,
    qaIssueCode: row.qaIssueCode,
    dispositionOn: row.dispositionOn,
    drawingNumber: row.drawingNumber,
    partNumber: enrichment.partNumber,
    partName: enrichment.partName,
    machineName: enrichment.machineName,
    rawPayload: row.rawPayload,
    contentHash: row.contentHash,
    enrichmentStatus: enrichment.enrichmentStatus,
    enrichedAt: enrichment.enrichedAt,
    sourceRowOrdinal: row.sourceRowOrdinal,
  };
}

function effectiveEnrichment(
  row: ScawStfutekigoNormalizedRow,
  incoming: ScawStfutekigoEnrichment,
  existing: {
    manufacturingOrderNo: string | null;
    partNumber: string | null;
    partName: string | null;
    machineName: string | null;
    resolvedSeiban: string | null;
    enrichmentStatus: ScawStfutekigoEnrichment['enrichmentStatus'];
    enrichedAt: Date | null;
  } | null
): ScawStfutekigoEnrichment {
  // A temporary lookup miss must not erase a previous successful order match. A changed
  // FSEZONO/order is a new lookup and therefore may clear the old resolved values.
  if (
    existing &&
    existing.manufacturingOrderNo === row.manufacturingOrderNo &&
    existing.enrichmentStatus === 'RESOLVED' &&
    incoming.enrichmentStatus !== 'RESOLVED'
  ) {
    return {
      partNumber: existing.partNumber,
      partName: existing.partName,
      machineName: existing.machineName,
      resolvedSeiban: existing.resolvedSeiban,
      enrichmentStatus: existing.enrichmentStatus,
      enrichedAt: existing.enrichedAt,
    };
  }
  if (
    existing &&
    existing.enrichmentStatus === 'RESOLVED' &&
    incoming.enrichmentStatus === 'RESOLVED' &&
    existing.partNumber === incoming.partNumber &&
    existing.partName === incoming.partName &&
    existing.machineName === incoming.machineName &&
    existing.resolvedSeiban === incoming.resolvedSeiban
  ) {
    return { ...incoming, enrichedAt: existing.enrichedAt };
  }
  return incoming;
}

async function loadIngestRun(client: PrismaClient, ingestRunId: string): Promise<IngestRun> {
  const run = await client.csvDashboardIngestRun.findUnique({
    where: { id: ingestRunId },
    select: {
      id: true,
      csvDashboardId: true,
      status: true,
      startedAt: true,
      sourceReceivedAt: true,
      completedAt: true,
      errorMessage: true,
      rowsProcessed: true,
    },
  });
  if (!run) throw new Error(`[ScawStfutekigoSync] ingest run not found: ${ingestRunId}`);
  if (run.csvDashboardId !== SCAW_STFUTEKIGO_DASHBOARD_ID) {
    throw new Error(`[ScawStfutekigoSync] ingest run dashboard mismatch: ${run.csvDashboardId}`);
  }
  if (run.status !== 'COMPLETED' || !run.completedAt) {
    throw new Error(`[ScawStfutekigoSync] ingest run is not completed: ${ingestRunId}`);
  }
  return run;
}

function warningMessage(existing: string | null, warnings: readonly string[]): string | null {
  if (warnings.length === 0) return existing;
  const line = `[scaw-stfutekigo-warning] ${warnings.slice(0, 100).join(' | ')}`;
  return existing ? `${existing}\n${line}` : line;
}

/** Compare persisted, non-null projection timestamps without relying on SQL NULL ordering. */
export function isScawStfutekigoSnapshotOlder(
  latestAppliedSnapshotReceivedAt: Date | null,
  incomingSnapshotReceivedAt: Date
): boolean {
  return latestAppliedSnapshotReceivedAt !== null && latestAppliedSnapshotReceivedAt > incomingSnapshotReceivedAt;
}

/** Apply one completed APPEND ingest as an atomic full snapshot projection. */
export class ScawStfutekigoSyncService {
  constructor(
    private readonly client: PrismaClient = prisma,
    private readonly enrichmentAdapter?: EnrichmentAdapter
  ) {}

  async syncFromScawStfutekigoDashboard(params: { ingestRunId: string }): Promise<ScawStfutekigoSyncResult> {
    const client = this.client;
    const run = await loadIngestRun(client, params.ingestRunId);
    try {
      const alreadyApplied = await client.scawStfutekigoCurrent.count({
        where: { lastEvaluatedIngestRunId: params.ingestRunId },
      });
      if (alreadyApplied > 0) {
        return {
          ingestRunId: params.ingestRunId,
          rowsScanned: 0,
          uniqueRows: 0,
          duplicateRows: 0,
          created: 0,
          updated: 0,
          reactivated: 0,
          disappeared: 0,
          resolved: 0,
          notFound: 0,
          ambiguous: 0,
          stagingRowsDeleted: await this.cleanup(client, params.ingestRunId),
          skippedAsOlder: false,
          skippedAsAlreadyApplied: true,
        };
      }

      const stagingRows = await loadScawStfutekigoStagingRows(client, params.ingestRunId);
      // A concurrent invocation may have passed the first check before the winner
      // committed and cleaned APPEND staging. The rowsProcessed audit count below
      // also covers an older run that was skipped before cleanup.
      if (stagingRows.length === 0) {
        const appliedAfterLoad = await client.scawStfutekigoCurrent.count({
          where: { lastEvaluatedIngestRunId: params.ingestRunId },
        });
        if (appliedAfterLoad > 0) {
          return {
            ingestRunId: params.ingestRunId,
            rowsScanned: 0,
            uniqueRows: 0,
            duplicateRows: 0,
            created: 0,
            updated: 0,
            reactivated: 0,
            disappeared: 0,
            resolved: 0,
            notFound: 0,
            ambiguous: 0,
            stagingRowsDeleted: 0,
            skippedAsOlder: false,
            skippedAsAlreadyApplied: true,
          };
        }
        // Projection cleanup runs only after a successful commit or an older-run
        // skip. A completed run with processed rows and no staging is therefore
        // an idempotent replay, not an empty full snapshot.
        if (run.rowsProcessed > 0) {
          return {
            ingestRunId: params.ingestRunId,
            rowsScanned: 0,
            uniqueRows: 0,
            duplicateRows: 0,
            created: 0,
            updated: 0,
            reactivated: 0,
            disappeared: 0,
            resolved: 0,
            notFound: 0,
            ambiguous: 0,
            stagingRowsDeleted: 0,
            skippedAsOlder: false,
            skippedAsAlreadyApplied: true,
          };
        }
      }
      const normalized = normalizeScawStfutekigoRows(stagingRows);
      const adapter = this.enrichmentAdapter ?? new ProductionScheduleScawStfutekigoEnrichmentAdapter(client);
      const orderNumbers = normalized.rows
        .map((row) => row.manufacturingOrderNo)
        .filter((value): value is string => Boolean(value));
      const enrichments = await adapter.enrich(orderNumbers);
      const evaluatedAt = run.completedAt ?? new Date();
      const snapshotReceivedAt = run.sourceReceivedAt ?? run.startedAt;

      const applied = await client.$transaction(
        async (tx) => {
          await acquireScawStfutekigoSnapshotLock(tx);
          // The advisory lock serializes concurrent projectors. Re-check the run
          // marker after acquiring it so the loser cannot apply the same snapshot.
          const alreadyAppliedInside = await tx.scawStfutekigoCurrent.count({
            where: { lastEvaluatedIngestRunId: params.ingestRunId },
          });
          if (alreadyAppliedInside > 0) {
            return {
              skippedAsOlder: false,
              skippedAsAlreadyApplied: true,
              created: 0,
              updated: 0,
              reactivated: 0,
              disappeared: 0,
            };
          }
          // Use the persisted projection timestamp rather than ordering nullable
          // ingest-run sourceReceivedAt values. PostgreSQL puts NULLs first for a
          // DESC order unless NULLS LAST is explicit, which could select an older
          // run and let it overwrite a newer snapshot.
          const newestAppliedCurrent = await tx.scawStfutekigoCurrent.findFirst({
            where: { lastSnapshotReceivedAt: { not: null } },
            select: { lastSnapshotReceivedAt: true },
            orderBy: {
              lastSnapshotReceivedAt: { sort: 'desc', nulls: 'last' },
            },
          });
          if (isScawStfutekigoSnapshotOlder(newestAppliedCurrent?.lastSnapshotReceivedAt ?? null, snapshotReceivedAt)) {
            return {
              skippedAsOlder: true,
              skippedAsAlreadyApplied: false,
              created: 0,
              updated: 0,
              reactivated: 0,
              disappeared: 0,
            };
          }

          const existingRows = await tx.scawStfutekigoCurrent.findMany({
            where: {
              nonconformityNo: {
                in: normalized.rows.map((row) => row.nonconformityNo),
              },
            },
          });
          const existingByKey = new Map(existingRows.map((row) => [row.nonconformityNo, row]));
          const newCurrentRows: Prisma.ScawStfutekigoCurrentUncheckedCreateInput[] = [];
          const newRevisionRows: Prisma.ScawStfutekigoRevisionUncheckedCreateInput[] = [];
          const metadataOnlyIds: string[] = [];
          const sourceChangedRows: Array<{
            id: string;
            fields: ReturnType<typeof domainFields>;
          }> = [];
          const revisionRows: Prisma.ScawStfutekigoRevisionUncheckedCreateInput[] = [];
          let reactivated = 0;

          for (const row of normalized.rows) {
            const current = existingByKey.get(row.nonconformityNo) ?? null;
            const incomingEnrichment = row.manufacturingOrderNo
              ? (enrichments.get(row.manufacturingOrderNo) ?? noEnrichment())
              : noEnrichment();
            const enrichment = effectiveEnrichment(row, incomingEnrichment, current);
            const fields = domainFields(row, enrichment);
            if (!current) {
              const currentId = randomUUID();
              const revisionId = randomUUID();
              newCurrentRows.push({
                id: currentId,
                ...fields,
                isPresentInLatestSnapshot: true,
                firstSeenAt: evaluatedAt,
                lastSeenIngestRunId: params.ingestRunId,
                lastEvaluatedIngestRunId: params.ingestRunId,
                lastSeenAt: evaluatedAt,
                lastSnapshotReceivedAt: snapshotReceivedAt,
                lastAbsentAt: null,
              } as Prisma.ScawStfutekigoCurrentUncheckedCreateInput);
              newRevisionRows.push({
                id: revisionId,
                ...fields,
                currentId,
                revisionType: 'CREATED',
                sourceIngestRunId: params.ingestRunId,
                observedAt: evaluatedAt,
              } as Prisma.ScawStfutekigoRevisionUncheckedCreateInput);
              continue;
            }

            const changed = current.contentHash !== row.contentHash;
            const enrichmentChanged =
              current.partNumber !== enrichment.partNumber ||
              current.partName !== enrichment.partName ||
              current.machineName !== enrichment.machineName ||
              current.resolvedSeiban !== enrichment.resolvedSeiban ||
              current.enrichmentStatus !== enrichment.enrichmentStatus;
            const rawChanged = JSON.stringify(current.rawPayload) !== JSON.stringify(row.rawPayload);
            const wasInactive = !current.isPresentInLatestSnapshot;
            if (wasInactive) reactivated += 1;
            if (changed || enrichmentChanged || rawChanged) {
              sourceChangedRows.push({ id: current.id, fields });
              if (changed) {
                revisionRows.push({
                  id: randomUUID(),
                  ...fields,
                  currentId: current.id,
                  revisionType: 'UPDATED',
                  sourceIngestRunId: params.ingestRunId,
                  observedAt: evaluatedAt,
                } as Prisma.ScawStfutekigoRevisionUncheckedCreateInput);
              }
            } else {
              metadataOnlyIds.push(current.id);
            }
          }

          for (let offset = 0; offset < newCurrentRows.length; offset += WRITE_CHUNK_SIZE) {
            await tx.scawStfutekigoCurrent.createMany({
              data: newCurrentRows.slice(offset, offset + WRITE_CHUNK_SIZE),
            });
          }
          for (let offset = 0; offset < newRevisionRows.length; offset += WRITE_CHUNK_SIZE) {
            await tx.scawStfutekigoRevision.createMany({
              data: newRevisionRows.slice(offset, offset + WRITE_CHUNK_SIZE),
            });
          }
          for (let offset = 0; offset < metadataOnlyIds.length; offset += WRITE_CHUNK_SIZE) {
            const ids = metadataOnlyIds.slice(offset, offset + WRITE_CHUNK_SIZE);
            await tx.scawStfutekigoCurrent.updateMany({
              where: { id: { in: ids } },
              data: {
                isPresentInLatestSnapshot: true,
                lastSeenIngestRunId: params.ingestRunId,
                lastEvaluatedIngestRunId: params.ingestRunId,
                lastSeenAt: evaluatedAt,
                lastSnapshotReceivedAt: snapshotReceivedAt,
              } as Prisma.ScawStfutekigoCurrentUncheckedUpdateInput,
            });
          }
          for (const row of sourceChangedRows) {
            await tx.scawStfutekigoCurrent.update({
              where: { id: row.id },
              data: {
                ...row.fields,
                isPresentInLatestSnapshot: true,
                lastSeenIngestRunId: params.ingestRunId,
                lastEvaluatedIngestRunId: params.ingestRunId,
                lastSeenAt: evaluatedAt,
                lastSnapshotReceivedAt: snapshotReceivedAt,
                // Keep lastAbsentAt as the last disappearance marker on reactivation.
              } as Prisma.ScawStfutekigoCurrentUncheckedUpdateInput,
            });
          }
          for (let offset = 0; offset < revisionRows.length; offset += WRITE_CHUNK_SIZE) {
            await tx.scawStfutekigoRevision.createMany({
              data: revisionRows.slice(offset, offset + WRITE_CHUNK_SIZE),
            });
          }

          const missingWhere = {
            isPresentInLatestSnapshot: true,
            OR: [{ lastSeenIngestRunId: { not: params.ingestRunId } }, { lastSeenIngestRunId: null }],
          } as Prisma.ScawStfutekigoCurrentWhereInput;
          const disappeared = await tx.scawStfutekigoCurrent.updateMany({
            where: missingWhere,
            data: {
              isPresentInLatestSnapshot: false,
              lastAbsentAt: evaluatedAt,
              lastSnapshotReceivedAt: snapshotReceivedAt,
            },
          });
          await tx.scawStfutekigoCurrent.updateMany({
            where: {
              isPresentInLatestSnapshot: false,
              OR: [{ lastSeenIngestRunId: { not: params.ingestRunId } }, { lastSeenIngestRunId: null }],
            },
            data: {
              lastEvaluatedIngestRunId: params.ingestRunId,
              lastSnapshotReceivedAt: snapshotReceivedAt,
            },
          });
          await tx.csvDashboardIngestRun.update({
            where: { id: params.ingestRunId },
            data: {
              rowsSkipped: { increment: normalized.duplicateCount },
              errorMessage: warningMessage(run.errorMessage, normalized.warnings),
            },
          });
          return {
            skippedAsOlder: false,
            skippedAsAlreadyApplied: false,
            created: newCurrentRows.length,
            updated: revisionRows.length,
            reactivated,
            disappeared: disappeared.count,
          };
        },
        { timeout: SYNC_TX_TIMEOUT_MS, maxWait: SYNC_TX_MAX_WAIT_MS }
      );

      const stagingRowsDeleted = await this.cleanup(client, params.ingestRunId);
      const enrichmentCounts = normalized.rows.reduce(
        (counts, row) => {
          const status =
            (row.manufacturingOrderNo ? enrichments.get(row.manufacturingOrderNo) : undefined)?.enrichmentStatus ??
            'NOT_FOUND';
          counts[status === 'RESOLVED' ? 'resolved' : status === 'AMBIGUOUS' ? 'ambiguous' : 'notFound'] += 1;
          return counts;
        },
        { resolved: 0, notFound: 0, ambiguous: 0 }
      );
      return {
        ingestRunId: params.ingestRunId,
        rowsScanned: stagingRows.length,
        uniqueRows: normalized.rows.length,
        duplicateRows: normalized.duplicateCount,
        ...applied,
        ...enrichmentCounts,
        stagingRowsDeleted,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        await client.csvDashboardIngestRun.update({
          where: { id: params.ingestRunId },
          data: { status: 'FAILED', errorMessage, completedAt: new Date() },
        });
      } catch (auditError) {
        logger.error(
          { err: auditError, ingestRunId: params.ingestRunId },
          '[ScawStfutekigoSync] failed to mark projection run as FAILED'
        );
      }
      throw error;
    }
  }

  private async cleanup(client: PrismaClient, ingestRunId: string): Promise<number> {
    try {
      return await deleteScawStfutekigoStagingRows(client, ingestRunId, CLEANUP_CHUNK_SIZE);
    } catch (error) {
      logger.warn({ err: error, ingestRunId }, '[ScawStfutekigoSync] staging cleanup failed; audit is retained');
      return 0;
    }
  }
}
