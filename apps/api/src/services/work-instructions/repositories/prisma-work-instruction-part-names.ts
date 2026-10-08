import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { normalizeWorkInstructionPartNumber } from '../domain/normalization.js';

type Db = Pick<PrismaClient, '$queryRaw'>;

/** No part-count cutoff: callers bound the matched materials/groups instead. */
export function matchingPartNumbersByNameSql(query: string): Prisma.Sql | null {
  const normalized = query.normalize('NFKC').trim();
  if (Array.from(normalized).length < 2) return null;
  const pattern = '%' + normalized.replace(/[\\%_]/g, (char) => '\\' + char) + '%';
  return Prisma.sql`
    SELECT DISTINCT UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) COLLATE "C" AS "partNumber"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND NULLIF(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC)), '') IS NOT NULL
      AND NORMALIZE("rowData"->>'FHINMEI', NFKC) ILIKE ${pattern} ESCAPE '\\'
  `;
}

export async function readMaterialMatchesByPartName(db: Db, query: string, scope: Prisma.Sql) {
  const parts = matchingPartNumbersByNameSql(query);
  if (!parts) return [];
  // Escape stored part numbers as literal regexps before adding ASCII word boundaries.
  const metacharacters = String.raw`([\\.^$|?*+()\[\]{}])`;
  const replacement = String.raw`\\\1`;
  return db.$queryRaw<Array<{ id: string; partNumber: string }>>(Prisma.sql`
    WITH matching_parts AS MATERIALIZED (${parts}), patterns AS MATERIALIZED (
      SELECT "partNumber", '(^|[^A-Z0-9])' ||
        regexp_replace("partNumber", ${metacharacters}, ${replacement}, 'g') || '([^A-Z0-9]|$)' AS pattern
      FROM matching_parts
    ), scoped_materials AS MATERIALIZED (
      SELECT material."id", material."receivedAt", material."createdAt",
        UPPER(TRIM(NORMALIZE(material."workInstructionRef"->>'partNumber', NFKC))) AS "partNumber",
        UPPER(NORMALIZE(material."subjectHint", NFKC)) AS hint,
        UPPER(NORMALIZE(material."originalFileName", NFKC)) AS filename
      FROM "ProcedureMaterial" AS material
      WHERE ${scope}
    )
    SELECT material."id", matched."partNumber"
    FROM scoped_materials AS material
    JOIN LATERAL (
      SELECT MIN(parts."partNumber" COLLATE "C") AS "partNumber"
      FROM patterns AS parts
      WHERE material."partNumber" = parts."partNumber"
        OR (POSITION(parts."partNumber" IN material.hint) > 0 AND material.hint ~ parts.pattern)
        OR (POSITION(parts."partNumber" IN material.filename) > 0 AND material.filename ~ parts.pattern)
    ) AS matched ON matched."partNumber" IS NOT NULL
    ORDER BY material."receivedAt" DESC, material."createdAt" DESC, material."id" DESC
    LIMIT 2000
  `);
}

export async function readPartNamesByPartNumbers(db: Db, partNumbers: string[]): Promise<Map<string, string | null>> {
  const normalized = [...new Set(partNumbers.flatMap((part) => normalizeWorkInstructionPartNumber(part) ?? []))];
  if (!normalized.length) return new Map();
  const records = await db.$queryRaw<Array<{ partNumber: string; partName: string | null }>>(Prisma.sql`
    SELECT UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) AS "partNumber", MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), '')) AS "partName"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) IN (${Prisma.join(normalized)})
    GROUP BY UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC)))
  `);
  return new Map(records.map((record) => [record.partNumber, record.partName?.trim() || null]));
}

export async function readPartNumbersByPartName(db: Db, query: string, limit = 200): Promise<string[]> {
  const parts = matchingPartNumbersByNameSql(query);
  if (!parts) return [];
  const records = await db.$queryRaw<Array<{ partNumber: string }>>(Prisma.sql`
    SELECT "partNumber" FROM (${parts}) AS parts
    ORDER BY "partNumber" ASC LIMIT ${Math.max(1, Math.min(limit, 200))}
  `);
  return [...new Set(records.flatMap((record) => normalizeWorkInstructionPartNumber(record.partNumber) ?? []))];
}
