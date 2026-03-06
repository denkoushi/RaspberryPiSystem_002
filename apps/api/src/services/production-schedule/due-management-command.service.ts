import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { isValidDueDateText, writebackSeibanDueDateToRowNotes } from './due-date-writeback.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

const normalizeOrderedFhincds = (orderedFhincds: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  for (const raw of orderedFhincds) {
    const normalized = raw.trim();
    if (normalized.length === 0 || unique.has(normalized)) continue;
    unique.add(normalized);
    next.push(normalized);
  }
  return next;
};

export async function upsertProductionScheduleSeibanDueDate(params: {
  locationKey: string;
  fseiban: string;
  dueDateText: string;
}): Promise<{ success: true; dueDate: Date | null; affectedRows: number }> {
  const { locationKey, fseiban, dueDateText } = params;
  const trimmedFseiban = fseiban.trim();
  if (trimmedFseiban.length === 0) {
    throw new ApiError(400, '製番は必須です');
  }
  if (!isValidDueDateText(dueDateText)) {
    throw new ApiError(400, '納期日はYYYY-MM-DD形式で入力してください');
  }

  const trimmedDueDate = dueDateText.trim();
  if (trimmedDueDate.length === 0) {
    await prisma.productionScheduleSeibanDueDate.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        fseiban: trimmedFseiban
      }
    });
    const writebackResult = await writebackSeibanDueDateToRowNotes({
      locationKey,
      fseiban: trimmedFseiban,
      dueDateText: ''
    });
    return {
      success: true,
      dueDate: null,
      affectedRows: writebackResult.affectedRows
    };
  }

  const dueDate = new Date(`${trimmedDueDate}T00:00:00.000Z`);
  await prisma.productionScheduleSeibanDueDate.upsert({
    where: {
      csvDashboardId_location_fseiban: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        fseiban: trimmedFseiban
      }
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      fseiban: trimmedFseiban,
      dueDate
    },
    update: {
      dueDate
    }
  });

  const writebackResult = await writebackSeibanDueDateToRowNotes({
    locationKey,
    fseiban: trimmedFseiban,
    dueDateText: trimmedDueDate
  });
  return {
    success: true,
    dueDate,
    affectedRows: writebackResult.affectedRows
  };
}

export async function upsertProductionSchedulePartPriorities(params: {
  locationKey: string;
  fseiban: string;
  orderedFhincds: string[];
}): Promise<{ success: true; priorities: Array<{ fhincd: string; priorityRank: number }> }> {
  const { locationKey, fseiban } = params;
  const trimmedFseiban = fseiban.trim();
  if (trimmedFseiban.length === 0) {
    throw new ApiError(400, '製番は必須です');
  }

  const orderedFhincds = normalizeOrderedFhincds(params.orderedFhincds);

  const existingFhincdRows = await prisma.$queryRaw<Array<{ fhincd: string }>>`
    SELECT DISTINCT ("rowData"->>'FHINCD') AS "fhincd"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("rowData"->>'FSEIBAN') = ${trimmedFseiban}
      AND NULLIF(TRIM("rowData"->>'FHINCD'), '') IS NOT NULL
  `;
  const allowedFhincdSet = new Set(existingFhincdRows.map((row) => row.fhincd.trim()).filter((value) => value.length > 0));
  const unknownFhincd = orderedFhincds.find((value) => !allowedFhincdSet.has(value));
  if (unknownFhincd) {
    throw new ApiError(400, '製番に存在しない部品コードが含まれています', { fhincd: unknownFhincd });
  }

  await prisma.$transaction(async (tx) => {
    await tx.productionSchedulePartPriority.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        fseiban: trimmedFseiban,
        ...(orderedFhincds.length > 0 ? { fhincd: { notIn: orderedFhincds } } : {})
      }
    });

    for (const [index, fhincd] of orderedFhincds.entries()) {
      await tx.productionSchedulePartPriority.upsert({
        where: {
          csvDashboardId_location_fseiban_fhincd: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: locationKey,
            fseiban: trimmedFseiban,
            fhincd
          }
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
          fseiban: trimmedFseiban,
          fhincd,
          priorityRank: index + 1
        },
        update: {
          priorityRank: index + 1
        }
      });
    }
  });

  return {
    success: true,
    priorities: orderedFhincds.map((fhincd, index) => ({
      fhincd,
      priorityRank: index + 1
    }))
  };
}
