import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export const CSV_DASHBOARD_RETENTION_BATCH_SIZE = 5000;
export const CSV_DASHBOARD_RETENTION_MAX_BATCHES = 400;

/**
 * 「基準日より古い行をすべて消す」対象のダッシュボード名。
 * 毎回の添付CSVに全期間分が入る一覧で、2年分あれば足りるもの。
 * 他の一覧は従来どおり前々年の1年分だけを消す（古い行に業務上の価値があり得るため）。
 */
export const CSV_DASHBOARD_CUTOFF_SWEEP_NAMES = ['加工機_日常点検結果'];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const jstYearStartUtc = (jstYear: number): Date => new Date(Date.UTC(jstYear, 0, 1) - JST_OFFSET_MS);

/** 日本時間の「前年1月1日 0:00」(UTC)。これより古い行が削除対象。 */
export function computeRetentionCutoffUtc(now: Date): Date {
  const jstYear = new Date(now.getTime() + JST_OFFSET_MS).getUTCFullYear();
  return jstYearStartUtc(jstYear - 1);
}

/** 日本時間の「前々年1年分」の範囲(UTC)。従来の削除範囲。 */
export function computeLegacyTwoYearsAgoWindowUtc(now: Date): { start: Date; endExclusive: Date } {
  const jstYear = new Date(now.getTime() + JST_OFFSET_MS).getUTCFullYear();
  return { start: jstYearStartUtc(jstYear - 2), endExclusive: jstYearStartUtc(jstYear - 1) };
}

export type RetentionSweepResult = {
  deletedRows: number;
  deletedIngestRuns: number;
  dryRun: boolean;
  truncated: boolean;
};

async function deleteRowsInBatches(where: Prisma.CsvDashboardRowWhereInput, dryRun: boolean) {
  if (dryRun) {
    return { count: await prisma.csvDashboardRow.count({ where }), truncated: false };
  }
  let count = 0;
  for (let batch = 0; batch < CSV_DASHBOARD_RETENTION_MAX_BATCHES; batch += 1) {
    const rows = await prisma.csvDashboardRow.findMany({
      where,
      select: { id: true },
      take: CSV_DASHBOARD_RETENTION_BATCH_SIZE,
    });
    if (rows.length === 0) return { count, truncated: false };
    // 選んだIDに加えて条件も付けたまま消す
    const result = await prisma.csvDashboardRow.deleteMany({
      where: { AND: [where, { id: { in: rows.map((row) => row.id) } }] },
    });
    count += result.count;
    if (rows.length < CSV_DASHBOARD_RETENTION_BATCH_SIZE) return { count, truncated: false };
  }
  return { count, truncated: true };
}

async function deleteIngestRunsInBatches(where: Prisma.CsvDashboardIngestRunWhereInput, dryRun: boolean) {
  if (dryRun) {
    return { count: await prisma.csvDashboardIngestRun.count({ where }), truncated: false };
  }
  let count = 0;
  for (let batch = 0; batch < CSV_DASHBOARD_RETENTION_MAX_BATCHES; batch += 1) {
    const runs = await prisma.csvDashboardIngestRun.findMany({
      where,
      select: { id: true },
      take: CSV_DASHBOARD_RETENTION_BATCH_SIZE,
    });
    if (runs.length === 0) return { count, truncated: false };
    const result = await prisma.csvDashboardIngestRun.deleteMany({
      where: { AND: [where, { id: { in: runs.map((run) => run.id) } }] },
    });
    count += result.count;
    if (runs.length < CSV_DASHBOARD_RETENTION_BATCH_SIZE) return { count, truncated: false };
  }
  return { count, truncated: true };
}

export async function runCsvDashboardRetentionSweep(
  now: Date,
  options: { dryRun?: boolean } = {}
): Promise<RetentionSweepResult> {
  const dryRun = options.dryRun ?? false;
  const legacy = computeLegacyTwoYearsAgoWindowUtc(now);
  const cutoff = computeRetentionCutoffUtc(now);

  const sweepDashboards = await prisma.csvDashboard.findMany({
    where: { name: { in: CSV_DASHBOARD_CUTOFF_SWEEP_NAMES } },
    select: { id: true },
  });
  const sweepIds = sweepDashboards.map((dashboard) => dashboard.id);

  const rowsLegacy = await deleteRowsInBatches(
    { occurredAt: { gte: legacy.start, lt: legacy.endExclusive } },
    dryRun
  );
  const runsLegacy = await deleteIngestRunsInBatches(
    { startedAt: { gte: legacy.start, lt: legacy.endExclusive } },
    dryRun
  );

  let rowsSweep = { count: 0, truncated: false };
  let runsSweep = { count: 0, truncated: false };
  if (sweepIds.length > 0) {
    rowsSweep = await deleteRowsInBatches(
      { csvDashboardId: { in: sweepIds }, occurredAt: { lt: cutoff } },
      dryRun
    );
    runsSweep = await deleteIngestRunsInBatches(
      { csvDashboardId: { in: sweepIds }, startedAt: { lt: cutoff } },
      dryRun
    );
  }

  return {
    deletedRows: rowsLegacy.count + rowsSweep.count,
    deletedIngestRuns: runsLegacy.count + runsSweep.count,
    dryRun,
    truncated: rowsLegacy.truncated || runsLegacy.truncated || rowsSweep.truncated || runsSweep.truncated,
  };
}
