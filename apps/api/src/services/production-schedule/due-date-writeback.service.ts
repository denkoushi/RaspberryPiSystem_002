import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const parseDueDateText = (dueDateText: string): Date | null => {
  const trimmed = dueDateText.trim();
  if (trimmed.length === 0) return null;
  return new Date(`${trimmed}T00:00:00.000Z`);
};

export async function writebackSeibanDueDateToRowNotes(params: {
  locationKey: string;
  fseiban: string;
  dueDateText: string;
}): Promise<{ affectedRows: number; dueDate: Date | null }> {
  const { fseiban } = params;
  const dueDate = parseDueDateText(params.dueDateText);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("rowData"->>'FSEIBAN') = ${fseiban}
  `;

  if (rows.length === 0) {
    return { affectedRows: 0, dueDate };
  }

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const existing = await tx.productionScheduleRowNote.findUnique({ where: { csvDashboardRowId: row.id } });

      if (!dueDate) {
        const hasNote = Boolean(existing?.note?.trim());
        const hasProcessing = Boolean(existing?.processingType?.trim());
        if (!hasNote && !hasProcessing) {
          await tx.productionScheduleRowNote.deleteMany({
            where: {
              csvDashboardRowId: row.id
            }
          });
          continue;
        }
      }

      await tx.productionScheduleRowNote.upsert({
        where: {
          csvDashboardRowId: row.id
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: row.id,
          note: existing?.note?.trim() ?? '',
          processingType: existing?.processingType ?? null,
          dueDate
        },
        update: { dueDate }
      });
    }
  });

  return { affectedRows: rows.length, dueDate };
}

export function isValidDueDateText(dueDateText: string): boolean {
  const trimmed = dueDateText.trim();
  if (trimmed.length === 0) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
}
