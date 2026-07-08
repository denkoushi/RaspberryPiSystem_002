import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';

export type InspectionDrawingFhincdCandidate = {
  fhincd: string;
  fhinmei: string | null;
};

const FHINCD_CANDIDATE_MIN_PREFIX_LEN = 2;
const FHINCD_CANDIDATE_DEFAULT_LIMIT = 20;

export async function listInspectionDrawingFhincdCandidates(
  prefix: string,
  limit = FHINCD_CANDIDATE_DEFAULT_LIMIT
): Promise<InspectionDrawingFhincdCandidate[]> {
  const trimmed = prefix.trim();
  if (trimmed.length < FHINCD_CANDIDATE_MIN_PREFIX_LEN) {
    return [];
  }

  const cappedLimit = Math.min(Math.max(Math.floor(limit), 1), FHINCD_CANDIDATE_DEFAULT_LIMIT);
  const prefixPattern = `${trimmed}%`;

  const rows = await prisma.$queryRaw<Array<{ fhincd: string; fhinmei: string | null }>>(Prisma.sql`
    SELECT
      MIN(TRIM("rowData"->>'FHINCD')) AS "fhincd",
      MIN("rowData"->>'FHINMEI') AS "fhinmei"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND TRIM(COALESCE("rowData"->>'FHINCD', '')) <> ''
      AND UPPER(TRIM("rowData"->>'FHINCD')) LIKE UPPER(${prefixPattern})
    GROUP BY UPPER(TRIM("rowData"->>'FHINCD'))
    ORDER BY 1 ASC
    LIMIT ${cappedLimit}
  `);

  return rows.map((row) => ({
    fhincd: row.fhincd?.trim() ?? '',
    fhinmei: row.fhinmei?.trim() || null
  }));
}
