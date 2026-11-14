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

type PruneResult = {
  deletedCount: number;
  // Disabled/failed runs cannot assert whether candidates remain.
  hasRemaining: boolean | null;
  failed?: boolean;
};

export class CsvDashboardAppendRawRowPruneService {
  private async candidates(dashboardId: string): Promise<Prisma.Sql> {
    if (!(APPEND_RAW_ROW_PRUNE_DASHBOARD_IDS as readonly string[]).includes(dashboardId)) {
      return Prisma.sql`SELECT "id" FROM "CsvDashboardRow" WHERE FALSE`;
    }
    const anchor = await prisma.csvDashboardIngestRun.findFirst({
      where: {
        csvDashboardId: dashboardId,
        status: 'COMPLETED',
        completedAt: { not: null },
        rowsAdded: { gt: 0 },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { startedAt: true },
    });
    if (!anchor) return Prisma.sql`SELECT "id" FROM "CsvDashboardRow" WHERE FALSE`;

    if (dashboardId === RIGGING_SLINGS_INSPECTION_POWERAPPS_DASHBOARD_ID) {
      // Rank the entire history before applying the cutoff: keep every distinct JSONB value.
      return Prisma.sql`
        SELECT "id" FROM (
          SELECT "id", "createdAt", ROW_NUMBER() OVER (
            PARTITION BY "rowData" ORDER BY "createdAt" DESC, "id" DESC
          ) AS rn
          FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${dashboardId}
        ) AS ranked
        WHERE rn > 1 AND "createdAt" < ${anchor.startedAt}
      `;
    }
    return Prisma.sql`
      SELECT "id" FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${dashboardId} AND "createdAt" < ${anchor.startedAt}
    `;
  }

  async count(dashboardId: string): Promise<{ dashboardId: string; eligibleCount: number; deleteCount: number; retainedCount: number }> {
    const candidates = await this.candidates(dashboardId);
    const [counts] = await prisma.$queryRaw<Array<{ eligible: bigint; total: bigint }>>(Prisma.sql`
      SELECT (SELECT COUNT(*) FROM (${candidates}) AS candidates) AS eligible,
        (SELECT COUNT(*) FROM "CsvDashboardRow" WHERE "csvDashboardId" = ${dashboardId}) AS total
    `);
    const eligibleCount = Number(counts.eligible);
    const deleteCount = Math.min(eligibleCount, MAX_DELETE);
    return { dashboardId, eligibleCount, deleteCount, retainedCount: Number(counts.total) - deleteCount };
  }

  async prune(dashboardId: string): Promise<PruneResult> {
    let deletedCount = 0;
    if (!env.CSV_APPEND_RAW_ROW_PRUNE_ENABLED) return { deletedCount, hasRemaining: null };
    try {
      // Freeze the cutoff for this invocation; a later completed run must not expand it mid-prune.
      const candidates = await this.candidates(dashboardId);
      for (let selectedCount = 0; selectedCount < MAX_DELETE; selectedCount += BATCH_SIZE) {
        const started = Date.now();
        const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM (${candidates}) AS candidates ORDER BY "id" LIMIT ${BATCH_SIZE}
        `);
        if (rows.length === 0) return { deletedCount, hasRemaining: false };
        deletedCount += await prisma.$executeRaw(Prisma.sql`
          DELETE FROM "CsvDashboardRow" WHERE "id" = ANY(${rows.map((row) => row.id)}::text[])
        `);
        await sleep(Math.max(1, Date.now() - started));
      }
      const remaining = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM (${candidates}) AS candidates LIMIT 1
      `);
      return { deletedCount, hasRemaining: remaining.length > 0 };
    } catch (error) {
      logger.error({ err: error, dashboardId, deletedCount }, '[CsvDashboardAppendRawRowPrune] prune failed');
      return { deletedCount, hasRemaining: null, failed: true };
    }
  }
}
