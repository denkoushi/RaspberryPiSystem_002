import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const parseDueDateText = (dueDateText: string): Date | null => {
  const trimmed = dueDateText.trim();
  if (trimmed.length === 0) return null;
  return new Date(`${trimmed}T00:00:00.000Z`);
};

const normalizeProcessingTypes = (processingTypes?: string[]): string[] =>
  Array.from(
    new Set(
      (processingTypes ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

const listSeibanRowIdsForWriteback = async (params: {
  fseiban: string;
  includeProcessingType?: string;
  excludeProcessingTypes?: string[];
}): Promise<string[]> => {
  const includeProcessingType = params.includeProcessingType?.trim() ?? '';
  const excludeProcessingTypes = normalizeProcessingTypes(params.excludeProcessingTypes);
  const includeProcessingFilter =
    includeProcessingType.length > 0
      ? prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "CsvDashboardRow"."id"
          FROM "CsvDashboardRow"
          LEFT JOIN "ProductionScheduleRowNote" AS "n"
            ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
            ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
          WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
            AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${params.fseiban}
            AND COALESCE("pp"."processingType", "n"."processingType") = ${includeProcessingType}
        `
      : excludeProcessingTypes.length > 0
        ? prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "CsvDashboardRow"."id"
            FROM "CsvDashboardRow"
            LEFT JOIN "ProductionScheduleRowNote" AS "n"
              ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
              AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
              ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
              AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
            WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
              AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
              AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${params.fseiban}
              AND (
                COALESCE("pp"."processingType", "n"."processingType") IS NULL
                OR COALESCE("pp"."processingType", "n"."processingType") NOT IN (${Prisma.join(excludeProcessingTypes)})
              )
          `
        : prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "CsvDashboardRow"
            WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
              AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
              AND ("rowData"->>'FSEIBAN') = ${params.fseiban}
          `;

  const rows = await includeProcessingFilter;
  return rows.map((row) => row.id);
};

const applyDueDateToRowNotes = async (rowIds: string[], dueDate: Date | null): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    for (const rowId of rowIds) {
      const existing = await tx.productionScheduleRowNote.findUnique({
        where: { csvDashboardRowId: rowId }
      });

      if (!dueDate) {
        const hasNote = Boolean(existing?.note?.trim());
        const hasProcessing = Boolean(existing?.processingType?.trim());
        if (!hasNote && !hasProcessing) {
          await tx.productionScheduleRowNote.deleteMany({
            where: {
              csvDashboardRowId: rowId
            }
          });
          continue;
        }
      }

      await tx.productionScheduleRowNote.upsert({
        where: {
          csvDashboardRowId: rowId
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: rowId,
          note: existing?.note?.trim() ?? '',
          processingType: existing?.processingType ?? null,
          dueDate
        },
        update: { dueDate }
      });
    }
  });
};

export async function writebackSeibanDueDateToRowNotes(params: {
  locationKey: string;
  fseiban: string;
  dueDateText: string;
  excludeProcessingTypes?: string[];
}): Promise<{ affectedRows: number; dueDate: Date | null }> {
  const { fseiban } = params;
  const dueDate = parseDueDateText(params.dueDateText);
  const rowIds = await listSeibanRowIdsForWriteback({
    fseiban,
    excludeProcessingTypes: params.excludeProcessingTypes
  });
  if (rowIds.length === 0) {
    return { affectedRows: 0, dueDate };
  }
  await applyDueDateToRowNotes(rowIds, dueDate);

  return { affectedRows: rowIds.length, dueDate };
}

export async function writebackSeibanProcessingDueDateToRowNotes(params: {
  locationKey: string;
  fseiban: string;
  processingType: string;
  dueDateText: string;
}): Promise<{ affectedRows: number; dueDate: Date | null }> {
  const dueDate = parseDueDateText(params.dueDateText);
  const rowIds = await listSeibanRowIdsForWriteback({
    fseiban: params.fseiban,
    includeProcessingType: params.processingType
  });
  if (rowIds.length === 0) {
    return { affectedRows: 0, dueDate };
  }
  await applyDueDateToRowNotes(rowIds, dueDate);
  return { affectedRows: rowIds.length, dueDate };
}

export function isValidDueDateText(dueDateText: string): boolean {
  const trimmed = dueDateText.trim();
  if (trimmed.length === 0) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
}
