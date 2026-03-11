import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { isValidDueDateText, writebackSeibanDueDateToRowNotes } from './due-date-writeback.service.js';
import { upsertProductionSchedulePartProcessingTypeByFhincd } from './production-schedule-command.service.js';
import { sharedScheduleFieldsRepository } from './shared-schedule-fields.repository.js';
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
    await sharedScheduleFieldsRepository.deleteSeibanDueDate(PRODUCTION_SCHEDULE_DASHBOARD_ID, trimmedFseiban);
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
  await sharedScheduleFieldsRepository.upsertSeibanDueDate({
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    fseiban: trimmedFseiban,
    dueDate
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

export async function upsertProductionScheduleDueManagementPartProcessingType(params: {
  locationKey: string;
  fseiban: string;
  fhincd: string;
  processingType: string;
}): Promise<{ success: true; fhincd: string; processingType: string | null }> {
  const { locationKey } = params;
  const fseiban = params.fseiban.trim();
  const fhincd = params.fhincd.trim();
  if (fseiban.length === 0) {
    throw new ApiError(400, '製番は必須です');
  }
  if (fhincd.length === 0) {
    throw new ApiError(400, '部品コードは必須です');
  }

  const existing = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND ("rowData"->>'FSEIBAN') = ${fseiban}
        AND ("rowData"->>'FHINCD') = ${fhincd}
    ) AS "exists"
  `;
  if (!existing[0]?.exists) {
    throw new ApiError(404, '指定された製番内に対象部品が見つかりません');
  }

  const result = await upsertProductionSchedulePartProcessingTypeByFhincd({
    locationKey,
    fhincd,
    processingType: params.processingType
  });

  return {
    success: true,
    fhincd,
    processingType: result.processingType
  };
}

export async function upsertProductionScheduleDueManagementPartNote(params: {
  locationKey: string;
  fseiban: string;
  fhincd: string;
  note: string;
}): Promise<{ success: true; fseiban: string; fhincd: string; note: string | null; affectedRows: number }> {
  const fseiban = params.fseiban.trim();
  const fhincd = params.fhincd.trim();
  if (fseiban.length === 0) {
    throw new ApiError(400, '製番は必須です');
  }
  if (fhincd.length === 0) {
    throw new ApiError(400, '部品コードは必須です');
  }
  const normalizedNote = params.note.replace(/\r?\n/g, '').trim().slice(0, 100);

  const targetRows = await prisma.$queryRaw<Array<{ rowId: string }>>`
    SELECT "CsvDashboardRow"."id" AS "rowId"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${fseiban}
      AND ("CsvDashboardRow"."rowData"->>'FHINCD') = ${fhincd}
  `;
  const rowIds = targetRows.map((row) => row.rowId);
  if (rowIds.length === 0) {
    throw new ApiError(404, '指定された製番内に対象部品が見つかりません');
  }

  const existingNotes = await sharedScheduleFieldsRepository.findRowNotesByRowIds(
    PRODUCTION_SCHEDULE_DASHBOARD_ID,
    rowIds
  );
  const existingByRowId = new Map(existingNotes.map((row) => [row.csvDashboardRowId, row] as const));

  await prisma.$transaction(async (tx) => {
    for (const rowId of rowIds) {
      const existing = existingByRowId.get(rowId);
      if (normalizedNote.length === 0) {
        const existingProcessing = existing?.processingType?.trim() ?? '';
        const hasDueDate = Boolean(existing?.dueDate);
        if (existingProcessing.length === 0 && !hasDueDate) {
          await tx.productionScheduleRowNote.deleteMany({
            where: {
              csvDashboardRowId: rowId
            }
          });
        } else {
          await tx.productionScheduleRowNote.update({
            where: {
              csvDashboardRowId: rowId
            },
            data: { note: '' }
          });
        }
        continue;
      }

      await tx.productionScheduleRowNote.upsert({
        where: {
          csvDashboardRowId: rowId
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: rowId,
          note: normalizedNote,
          processingType: existing?.processingType ?? null,
          dueDate: existing?.dueDate ?? null
        },
        update: {
          note: normalizedNote
        }
      });
    }
  });

  return {
    success: true,
    fseiban,
    fhincd,
    note: normalizedNote.length > 0 ? normalizedNote : null,
    affectedRows: rowIds.length
  };
}
