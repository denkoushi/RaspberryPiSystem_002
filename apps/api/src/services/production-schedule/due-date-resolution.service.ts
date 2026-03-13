import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type EffectiveDueDateRow = {
  fseiban: string;
  minDueDate: Date | null;
};

type SeibanProcessingDueDateRow = {
  processingType: string;
  dueDate: Date;
};

const normalizeFseibans = (fseibans: string[] | undefined): string[] =>
  Array.from(
    new Set(
      (fseibans ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

export async function listEarliestEffectiveDueDateBySeiban(
  fseibans?: string[]
): Promise<Map<string, Date | null>> {
  const targets = normalizeFseibans(fseibans);
  const targetFilter =
    targets.length > 0
      ? Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(targets)})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<EffectiveDueDateRow[]>(Prisma.sql`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      MIN("n"."dueDate") AS "minDueDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND NULLIF(TRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IS NOT NULL
      ${targetFilter}
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
  `);

  return new Map(rows.map((row) => [row.fseiban, row.minDueDate] as const));
}

export async function listSeibanProcessingDueDates(fseiban: string): Promise<Map<string, Date>> {
  const trimmedFseiban = fseiban.trim();
  if (trimmedFseiban.length === 0) return new Map<string, Date>();
  const rows = await prisma.$queryRaw<SeibanProcessingDueDateRow[]>`
    SELECT "processingType", "dueDate"
    FROM "ProductionScheduleSeibanProcessingDueDate"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "fseiban" = ${trimmedFseiban}
  `;
  return new Map(rows.map((row) => [row.processingType, row.dueDate] as const));
}
