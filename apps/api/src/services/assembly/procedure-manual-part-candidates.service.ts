import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { normalizeWorkInstructionPartNumber } from '../work-instructions/domain/normalization.js';

export type ProcedureManualPartCandidate = {
  partNumber: string;
  partNumberKey: string;
  partName: string | null;
  hasManual: boolean;
};

// Match JavaScript trim at the database boundary, including full-width spaces.
const trimCharacters = ' \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

export class ProcedureManualPartCandidatesService {
  async list(query: { q?: string; digitQuery?: string; limit?: number } = {}): Promise<ProcedureManualPartCandidate[]> {
    const q = normalizeWorkInstructionPartNumber(query.q) ?? '';
    const digitQuery = query.digitQuery ?? '';
    const limit = Math.min(Math.max(Math.floor(query.limit ?? 30), 1), 50);
    return prisma.$queryRaw<ProcedureManualPartCandidate[]>(Prisma.sql`
      WITH sources AS (
        SELECT a."modelCode" AS "partNumber",
          UPPER(BTRIM(NORMALIZE(a."modelCode", NFKC), ${trimCharacters})) AS "partNumberKey",
          NULL::text AS "partName", true AS "hasManual"
        FROM "ProcedureManualAssignment" a
        JOIN "ProcedureManualProcess" p ON p."id" = a."processId"
        WHERE p."subjectKind" = 'PART'
        UNION ALL
        SELECT BTRIM("rowData"->>'FHINCD', ${trimCharacters}) AS "partNumber",
          UPPER(BTRIM(NORMALIZE("rowData"->>'FHINCD', NFKC), ${trimCharacters})) AS "partNumberKey",
          NULLIF(BTRIM(NORMALIZE("rowData"->>'FHINMEI', NFKC), ${trimCharacters}), '') AS "partName", false AS "hasManual"
        FROM "CsvDashboardRow"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      ), parts AS (
        SELECT "partNumberKey",
          COALESCE(MIN("partNumber") FILTER (WHERE "hasManual"), MIN("partNumber")) AS "partNumber",
          MIN("partName") AS "partName", BOOL_OR("hasManual") AS "hasManual"
        FROM sources
        WHERE COALESCE("partNumberKey", '') <> ''
        GROUP BY "partNumberKey"
      )
      SELECT "partNumber", "partNumberKey", "partName", "hasManual" FROM parts
      WHERE (${Boolean(q || digitQuery)} OR "hasManual")
        AND STRPOS(REGEXP_REPLACE("partNumberKey", '[^0-9]', '', 'g'), ${digitQuery}) > 0
        AND (STRPOS("partNumberKey", ${q}) > 0
          OR STRPOS(UPPER(NORMALIZE(COALESCE("partName", ''), NFKC)), ${q}) > 0)
      ORDER BY ("partNumberKey" = ${q}) DESC, "hasManual" DESC, "partNumberKey" ASC
      LIMIT ${limit}
    `);
  }
}
