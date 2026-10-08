import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { normalizeWorkInstructionPartNumber } from '../domain/normalization.js';

type Db = Pick<PrismaClient, '$queryRaw'>;
export async function readPartNamesByPartNumbers(db: Db, partNumbers: string[]): Promise<Map<string, string | null>> {
  const normalized = [...new Set(partNumbers.flatMap((part) => normalizeWorkInstructionPartNumber(part) ?? []))];
  if (!normalized.length) return new Map();
  const records = await db.$queryRaw<Array<{ partNumber: string; partName: string | null }>>(Prisma.sql`
    SELECT UPPER(TRIM("rowData"->>'FHINCD')) AS "partNumber", MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), '')) AS "partName"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND UPPER(TRIM("rowData"->>'FHINCD')) IN (${Prisma.join(normalized)})
    GROUP BY UPPER(TRIM("rowData"->>'FHINCD'))
  `);
  return new Map(records.map((record) => [record.partNumber, record.partName?.trim() || null]));
}

export async function readPartNumbersByPartName(db: Db, query: string, limit = 200): Promise<string[]> {
  const normalized = query.normalize('NFKC').trim();
  if (!normalized) return [];
  const pattern = `%${normalized.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const records = await db.$queryRaw<Array<{ partNumber: string }>>(Prisma.sql`
    SELECT DISTINCT UPPER(TRIM("rowData"->>'FHINCD')) COLLATE "C" AS "partNumber"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND NULLIF(TRIM("rowData"->>'FHINCD'), '') IS NOT NULL
      AND NORMALIZE("rowData"->>'FHINMEI', NFKC) ILIKE ${pattern} ESCAPE '\\'
    ORDER BY "partNumber" ASC LIMIT ${Math.max(1, Math.min(limit, 200))}
  `);
  return [...new Set(records.flatMap((record) => normalizeWorkInstructionPartNumber(record.partNumber) ?? []))];
}
