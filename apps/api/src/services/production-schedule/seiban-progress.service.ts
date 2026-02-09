import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export type SeibanProgressRow = {
  fseiban: string;
  total: number;
  completed: number;
  incompleteProductNames: string[] | null;
};

const normalizeSeibanList = (values: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .forEach((value) => {
      if (unique.has(value)) return;
      unique.add(value);
      next.push(value);
    });
  return next;
};

export async function fetchSeibanProgressRows(
  fseibans: string[],
  csvDashboardId: string = PRODUCTION_SCHEDULE_DASHBOARD_ID
): Promise<SeibanProgressRow[]> {
  const normalized = normalizeSeibanList(fseibans);
  if (normalized.length === 0) {
    return [];
  }

  return prisma.$queryRaw<SeibanProgressRow[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      COUNT(*)::int AS "total",
      SUM(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'progress') = ${COMPLETED_PROGRESS_VALUE}
          THEN 1
          ELSE 0
        END
      )::int AS "completed"
      ,
      ARRAY_AGG(DISTINCT ("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE ("CsvDashboardRow"."rowData"->>'progress') IS DISTINCT FROM ${COMPLETED_PROGRESS_VALUE}
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "incompleteProductNames"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${csvDashboardId}
      AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
        normalized.map((value) => Prisma.sql`${value}`),
        ','
      )})
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
    ORDER BY ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
  `;
}
