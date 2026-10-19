import type { PrismaClient } from '@prisma/client';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from './constants.js';

export type ScawStfutekigoStagingRow = {
  rowData: unknown;
  sourceRowOrdinal: number | null;
};

export async function loadScawStfutekigoStagingRows(
  client: Pick<PrismaClient, 'csvDashboardRow'>,
  ingestRunId: string
): Promise<ScawStfutekigoStagingRow[]> {
  const rows = await client.csvDashboardRow.findMany({
    where: { csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID, sourceIngestRunId: ingestRunId },
    select: { rowData: true, sourceRowOrdinal: true },
    orderBy: [{ sourceRowOrdinal: 'asc' }, { id: 'asc' }],
  });
  return rows;
}

/** Delete APPEND staging in bounded chunks; raw CSV and the ingest run remain audit records. */
export async function deleteScawStfutekigoStagingRows(
  client: Pick<PrismaClient, 'csvDashboardRow'>,
  ingestRunId: string,
  chunkSize = 500
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const rows = await client.csvDashboardRow.findMany({
      where: { csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID, sourceIngestRunId: ingestRunId },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: chunkSize,
    });
    if (rows.length === 0) return deleted;
    const result = await client.csvDashboardRow.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    deleted += result.count;
    if (result.count === 0) return deleted;
  }
}
