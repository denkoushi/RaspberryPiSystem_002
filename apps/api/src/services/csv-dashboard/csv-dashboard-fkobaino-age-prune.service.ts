import { setTimeout as sleep } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID } from '../production-schedule/constants.js';
import { withCsvDashboardIngestLock } from './csv-dashboard-ingest-lock.js';

export const FKOBAINO_AGE_PRUNE_DAYS = 90;
const BATCH_SIZE = 1_000;
const MAX_DELETE = 20_000;
const dashboardId = PRODUCTION_SCHEDULE_FKOBAINO_DASHBOARD_ID;

export type FkobainoAgePruneResult = {
  deletedCount: number;
  hasRemaining: boolean | null;
  failed?: boolean;
  skippedReason?: 'not-dedup';
};

export class CsvDashboardFkobainoAgePruneService {
  private async candidates(ingestRunId?: string): Promise<{ where: Prisma.Sql; skippedReason?: 'not-dedup' }> {
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id: dashboardId }, select: { ingestMode: true },
    });
    if (dashboard?.ingestMode !== 'DEDUP') return { where: Prisma.sql`FALSE`, skippedReason: 'not-dedup' };
    const cutoff = new Date(Date.now() - FKOBAINO_AGE_PRUNE_DAYS * 24 * 60 * 60 * 1000);
    const excludeCurrentRun = ingestRunId == null
      ? Prisma.sql`TRUE`
      : Prisma.sql`"sourceIngestRunId" IS DISTINCT FROM ${ingestRunId}::text`;
    return { where: Prisma.sql`
      "csvDashboardId" = ${dashboardId} AND "occurredAt" < ${cutoff}
      AND ${excludeCurrentRun}
    ` };
  }

  async count(ingestRunId?: string) {
    const { where, skippedReason } = await this.candidates(ingestRunId);
    const [counts] = await prisma.$queryRaw<Array<{ eligible: bigint; total: bigint }>>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM "CsvDashboardRow" WHERE ${where}) AS eligible,
        (SELECT COUNT(*) FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${dashboardId}) AS total
    `);
    const eligibleCount = Number(counts.eligible);
    const deleteCount = Math.min(eligibleCount, MAX_DELETE);
    return { dashboardId, eligibleCount, deleteCount, retainedCount: Number(counts.total) - deleteCount, ...(skippedReason ? { skippedReason } : {}) };
  }

  async prune(ingestRunId?: string): Promise<FkobainoAgePruneResult> {
    let deletedCount = 0;
    if (!env.CSV_FKOBAINO_AGE_PRUNE_ENABLED) return { deletedCount, hasRemaining: null };
    try {
      const { where, skippedReason } = await this.candidates(ingestRunId);
      if (skippedReason) return { deletedCount, hasRemaining: false, skippedReason };
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "CsvDashboardRow" WHERE ${where} LIMIT ${MAX_DELETE}
      `);
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        // Share the ingest mutex only during DELETE, never while sleeping. This prevents
        // deleting an existing row between the next ingest's diff read and ID update.
        const elapsed = await withCsvDashboardIngestLock(dashboardId, async () => {
          const started = Date.now();
          // Recheck freshness after an intervening ingest has released the mutex.
          deletedCount += await prisma.$executeRaw(Prisma.sql`
            DELETE FROM "CsvDashboardRow" WHERE "id" = ANY(${batch.map((row) => row.id)}::text[])
              AND ${where}
          `);
          return Date.now() - started;
        });
        await sleep(Math.max(1, elapsed));
      }
      return { deletedCount, hasRemaining: rows.length === MAX_DELETE };
    } catch (error) {
      logger.error({ err: error, dashboardId, ingestRunId, deletedCount }, '[CsvDashboardFkobainoAgePrune] prune failed');
      return { deletedCount, hasRemaining: null, failed: true };
    }
  }
}
