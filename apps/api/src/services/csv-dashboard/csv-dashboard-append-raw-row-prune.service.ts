import { setTimeout as sleep } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../production-schedule/constants.js';
import { RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID } from '../rigging/constants.js';

export const APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS = [
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
  RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID,
] as const;
const BATCH_SIZE = 1_000;
const MAX_DELETE = 20_000;

type SkippedReason = 'not-append' | 'no-anchor' | 'anchor-row-count-mismatch' | 'unsupported-dashboard';

export type PruneResult = {
  deletedCount: number;
  // Disabled/failed runs cannot assert whether candidates remain.
  hasRemaining: boolean | null;
  failed?: boolean;
  skippedReason?: SkippedReason;
};

export class CsvDashboardAppendRawRowPruneService {
  private async candidates(dashboardId: string): Promise<{ sql: Prisma.Sql; skippedReason?: SkippedReason }> {
    const skip = (skippedReason: SkippedReason) => ({
      sql: Prisma.sql`SELECT "id" FROM "CsvDashboardRow" WHERE FALSE`, skippedReason,
    });
    if (!(APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS as readonly string[]).includes(dashboardId)) {
      return skip('unsupported-dashboard');
    }
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id: dashboardId },
      select: { ingestMode: true },
    });
    if (dashboard?.ingestMode !== 'APPEND') return skip('not-append');

    const anchor = await prisma.csvDashboardIngestRun.findFirst({
      where: {
        csvDashboardId: dashboardId,
        status: 'COMPLETED',
        completedAt: { not: null },
        rowsAdded: { gt: 0 },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { startedAt: true, completedAt: true, rowsAdded: true, id: true },
    });
    if (!anchor?.completedAt) return skip('no-anchor');

    const [anchorRows] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${dashboardId}
        AND "createdAt" >= ${anchor.startedAt} AND "createdAt" <= ${anchor.completedAt}
    `);
    if (anchorRows.count !== BigInt(anchor.rowsAdded)) {
      logger.warn({ dashboardId, anchorRunId: anchor.id, rowsAdded: anchor.rowsAdded, actualCount: Number(anchorRows.count) },
        '[CsvDashboardAppendRawRowPrune] anchor row count mismatch');
      return skip('anchor-row-count-mismatch');
    }

    const now = new Date();
    const processing = await prisma.csvDashboardIngestRun.findFirst({
      where: {
        csvDashboardId: dashboardId,
        status: 'PROCESSING',
        startedAt: { gte: new Date(now.getTime() - 6 * 60 * 60 * 1000), lte: now },
      },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true },
    });
    const cutoff = processing && processing.startedAt < anchor.startedAt ? processing.startedAt : anchor.startedAt;

    if (dashboardId === RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID) {
      // Rank the entire history before applying the cutoff: keep every distinct JSONB value.
      return { sql: Prisma.sql`
        SELECT "id" FROM (
          SELECT "id", "createdAt", ROW_NUMBER() OVER (
            PARTITION BY "rowData" ORDER BY "createdAt" ASC, "id" ASC
          ) AS rn
          FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${dashboardId}
        ) AS ranked
        WHERE rn > 1 AND "createdAt" < ${cutoff}
      ` };
    }
    return { sql: Prisma.sql`
      SELECT "id" FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${dashboardId} AND "createdAt" < ${cutoff}
    ` };
  }

  async count(dashboardId: string): Promise<{ dashboardId: string; eligibleCount: number; deleteCount: number; retainedCount: number; skippedReason?: SkippedReason }> {
    const { sql: candidates, skippedReason } = await this.candidates(dashboardId);
    const [counts] = await prisma.$queryRaw<Array<{ eligible: bigint; total: bigint }>>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM (${candidates}) AS candidates) AS eligible,
        (SELECT COUNT(*) FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${dashboardId}) AS total
    `);
    const eligibleCount = Number(counts.eligible);
    const deleteCount = Math.min(eligibleCount, MAX_DELETE);
    return { dashboardId, eligibleCount, deleteCount, retainedCount: Number(counts.total) - deleteCount, ...(skippedReason ? { skippedReason } : {}) };
  }

  async prune(dashboardId: string): Promise<PruneResult> {
    let deletedCount = 0;
    if (!env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED) return { deletedCount, hasRemaining: null };
    try {
      // Freeze the cutoff for this invocation; a later completed run must not expand it mid-prune.
      const { sql: candidates, skippedReason } = await this.candidates(dashboardId);
      if (skippedReason) return { deletedCount, hasRemaining: false, skippedReason };
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM (${candidates}) AS c LIMIT ${MAX_DELETE}
      `);
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const started = Date.now();
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        deletedCount += await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "CsvDashboardRow" WHERE "id" = ANY(${batch.map((row) => row.id)}::text[])
        `);
        await sleep(Math.max(1, Date.now() - started));
      }
      return { deletedCount, hasRemaining: rows.length === MAX_DELETE };
    } catch (error) {
      logger.error({ err: error, dashboardId, deletedCount }, '[CsvDashboardAppendRawRowPrune] prune failed');
      return { deletedCount, hasRemaining: null, failed: true };
    }
  }
}
