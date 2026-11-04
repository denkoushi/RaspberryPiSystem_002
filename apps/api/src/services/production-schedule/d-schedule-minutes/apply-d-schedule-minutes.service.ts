import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { readWinnerRowsByFseibans } from '../grinding-planning-board/source.js';
import { asRowData, valueAsString } from '../grinding-planning-board/shared.js';
import type { DScheduleMinutesParseResult, DScheduleMinutesWarning } from './parse-d-schedule-minutes.js';
import type { DScheduleMinutesMetrics } from './import-summary.js';
import { autoRegisterDScheduleMinutes } from './auto-register-d-schedule-minutes.service.js';

export type DScheduleMinutesRunMetadata = {
  gmailMessageId: string;
  subject: string;
  filename: string;
  receivedAt: Date;
  originalFilePath?: string | null;
};

/** Persist the parsed file atomically before changing either board's registration. */
export async function applyDScheduleMinutes(input: {
  result: Extract<DScheduleMinutesParseResult, { ok: true }>;
  metadata: DScheduleMinutesRunMetadata;
}) {
  const run = await prisma.$transaction(async (tx) => {
    // Serialize apply/registration operations for this single dashboard.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('d-schedule-minutes'))`;
    const existingRun = await tx.productionScheduleDScheduleMinutesImportRun.findUnique({
      where: { gmailMessageId: input.metadata.gmailMessageId }
    });
    if (existingRun) return existingRun;
    const warnings: DScheduleMinutesWarning[] = [...input.result.warnings];
    const metrics: DScheduleMinutesMetrics = { seibansRead: new Set(input.result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans])).size, dateChanged: 0, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] };
    const created = await tx.productionScheduleDScheduleMinutesImportRun.create({
      data: {
        ...input.metadata,
        meetingDate: new Date(`${input.result.meetingDate}T00:00:00.000Z`),
        status: 'APPLIED',
        warnings: [],
        autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics }
      }
    });
    const winnerRows = await readWinnerRowsByFseibans(tx,
      input.result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans]));
    const scheduled = new Set(winnerRows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')).filter(Boolean));
    const changedAt = new Date();
    for (const block of input.result.blocks) {
      for (const fseiban of [block.seiban, ...block.aliasSeibans]) {
        const scope = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban };
        const previous = await tx.productionScheduleDScheduleMinutes.findUnique({
          where: { csvDashboardId_fseiban: scope }, include: { sourceRun: { select: { meetingDate: true } } }
        });
        const warn = (code: string) => warnings.push({ code, seiban: fseiban, cell: `B${block.sourceRow}`, rawText: block.rawPartsCompleteText });
        if (previous && previous.sourceRun.meetingDate > created.meetingDate) {
          if (!warnings.some((warning) => warning.code === 'STALE_FILE' && warning.seiban === fseiban)) warn('STALE_FILE');
          continue;
        }
        if (!scheduled.has(fseiban)) warn('NOT_IN_SCHEDULE');
        if (!previous && await tx.productionScheduleSeibanDueDate.findUnique({ where: { csvDashboardId_fseiban: scope } })) {
          warn('MANUAL_DUE_EXISTS_FIRST_TIME');
        }
        const partsCompleteDate = block.partsCompleteDate ? new Date(`${block.partsCompleteDate}T00:00:00.000Z`) : null;
        const dateChanged = (previous?.partsCompleteDate?.getTime() ?? null) !== (partsCompleteDate?.getTime() ?? null);
        if (dateChanged) metrics.dateChanged += 1;
        else metrics.unchanged += 1;
        const values = {
          partsCompleteDate,
          outsourceMarks: block.outsourceMarks,
          surfaceSendOutDates: block.surfaceSendOutDates,
          memo: block.memo,
          rawPartsCompleteText: block.rawPartsCompleteText,
          sourceRow: block.sourceRow,
          isAlias: fseiban !== block.seiban,
          aliasOf: fseiban !== block.seiban ? block.seiban : null
        };
        // Keep provenance and updatedAt intact for an identical file, including a new message ID.
        const unchanged = previous && !dateChanged &&
          JSON.stringify(previous.outsourceMarks) === JSON.stringify(values.outsourceMarks) &&
          isDeepStrictEqual(previous.surfaceSendOutDates, values.surfaceSendOutDates) &&
          previous.memo === values.memo && previous.rawPartsCompleteText === values.rawPartsCompleteText &&
          previous.sourceRow === values.sourceRow && previous.isAlias === values.isAlias && previous.aliasOf === values.aliasOf;
        if (unchanged) continue;
        await tx.productionScheduleDScheduleMinutes.upsert({
          where: { csvDashboardId_fseiban: scope },
          create: { ...scope, ...values, sourceRunId: created.id, excelChangedAt: changedAt },
          update: { ...values, sourceRunId: created.id, ...(dateChanged ? { excelChangedAt: changedAt } : {}) }
        });
      }
    }
    return tx.productionScheduleDScheduleMinutesImportRun.update({
      where: { id: created.id }, data: { warnings: warnings as Prisma.InputJsonValue[], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics } }
    });
  }, { timeout: 30000 });
  if (run.status !== 'SUCCESS') {
    await autoRegisterDScheduleMinutes({ runId: run.id, blocks: input.result.blocks });
  }
  return prisma.productionScheduleDScheduleMinutesImportRun.findUniqueOrThrow({ where: { id: run.id } });
}
