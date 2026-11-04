import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';

import { env } from '../../../config/env.js';
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

export class DScheduleMinutesComparisonError extends Error {}

type ComparisonThresholds = {
  minSeibanRatio: number;
  largeChangeDays: number;
  maxLargeChangeRatio: number;
  minCompared: number;
};

function readablePartsDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Persist the parsed file atomically before changing either board's registration. */
export async function applyDScheduleMinutes(input: {
  result: Extract<DScheduleMinutesParseResult, { ok: true }>;
  metadata: DScheduleMinutesRunMetadata;
  thresholds?: Partial<ComparisonThresholds>;
}) {
  const thresholds: ComparisonThresholds = {
    minSeibanRatio: env.D_SCHEDULE_MINUTES_MIN_SEIBAN_RATIO,
    largeChangeDays: env.D_SCHEDULE_MINUTES_LARGE_CHANGE_DAYS,
    maxLargeChangeRatio: env.D_SCHEDULE_MINUTES_MAX_LARGE_CHANGE_RATIO,
    minCompared: env.D_SCHEDULE_MINUTES_MIN_COMPARED,
    ...input.thresholds
  };
  const run = await prisma.$transaction(async (tx) => {
    // Serialize apply/registration operations for this single dashboard.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('d-schedule-minutes'))`;
    const existingRun = await tx.productionScheduleDScheduleMinutesImportRun.findUnique({
      where: { gmailMessageId: input.metadata.gmailMessageId }
    });
    if (existingRun) return existingRun;
    const warnings: DScheduleMinutesWarning[] = [...input.result.warnings];
    const metrics: DScheduleMinutesMetrics = { seibansRead: new Set(input.result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans])).size, dateChanged: 0, unchanged: 0, registeredSeibans: [], unregisteredSeibans: [] };
    const meetingDate = new Date(`${input.result.meetingDate}T00:00:00.000Z`);
    const previousRun = await tx.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { status: 'SUCCESS', meetingDate: { lt: meetingDate } },
      orderBy: [{ meetingDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
    });
    const previousMetrics = (previousRun?.autoRegisteredSeibans as { metrics?: DScheduleMinutesMetrics } | null)?.metrics;
    if (previousMetrics && metrics.seibansRead < thresholds.minSeibanRatio * previousMetrics.seibansRead) {
      throw new DScheduleMinutesComparisonError(`前回より製番が大きく減りました: 前回${previousMetrics.seibansRead}件, 今回${metrics.seibansRead}件`);
    }
    // Read and compare every distinct key before the first write, under the same lock.
    const targets = [];
    const seen = new Set<string>();
    let compared = 0;
    let largeChanges = 0;
    for (const block of input.result.blocks) {
      for (const fseiban of [block.seiban, ...block.aliasSeibans]) {
        if (seen.has(fseiban)) continue;
        seen.add(fseiban);
        const scope = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban };
        const previous = await tx.productionScheduleDScheduleMinutes.findUnique({
          where: { csvDashboardId_fseiban: scope }, include: { sourceRun: { select: { meetingDate: true } } }
        });
        const incomingDate = readablePartsDate(block.partsCompleteDate);
        targets.push({ block, fseiban, scope, previous, incomingDate });
        if (previousRun && previous?.partsCompleteDate && incomingDate) {
          compared += 1;
          if (Math.abs(incomingDate.getTime() - previous.partsCompleteDate.getTime()) >= thresholds.largeChangeDays * 86400000) {
            largeChanges += 1;
            warnings.push({ code: 'LARGE_DUE_CHANGE', seiban: fseiban, cell: `B${block.sourceRow}`,
              rawText: `${previous.partsCompleteDate.toISOString().slice(0, 10)}→${block.partsCompleteDate}` });
          }
        }
      }
    }
    if (compared >= thresholds.minCompared && largeChanges / compared > thresholds.maxLargeChangeRatio) {
      throw new DScheduleMinutesComparisonError(`${thresholds.largeChangeDays}日以上変わった製番が多すぎます: ${largeChanges}/${compared}件`);
    }
    const created = await tx.productionScheduleDScheduleMinutesImportRun.create({
      data: {
        ...input.metadata,
        meetingDate,
        status: 'APPLIED',
        warnings: [],
        autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics }
      }
    });
    const winnerRows = await readWinnerRowsByFseibans(tx,
      input.result.blocks.flatMap((block) => [block.seiban, ...block.aliasSeibans]));
    const scheduled = new Set(winnerRows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')).filter(Boolean));
    const changedAt = new Date();
    for (const { block, fseiban, scope, previous, incomingDate } of targets) {
      const warn = (code: string) => warnings.push({ code, seiban: fseiban, cell: `B${block.sourceRow}`, rawText: block.rawPartsCompleteText });
      if (previous && previous.sourceRun.meetingDate > created.meetingDate) {
        if (!warnings.some((warning) => warning.code === 'STALE_FILE' && warning.seiban === fseiban)) warn('STALE_FILE');
        continue;
      }
      if (!scheduled.has(fseiban)) warn('NOT_IN_SCHEDULE');
      if (!previous && await tx.productionScheduleSeibanDueDate.findUnique({ where: { csvDashboardId_fseiban: scope } })) {
        warn('MANUAL_DUE_EXISTS_FIRST_TIME');
      }
      if (block.partsCompleteDate && !incomingDate) warn('UNREADABLE_DATE');
      const partsCompleteDate = incomingDate ?? previous?.partsCompleteDate ?? null;
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
    return tx.productionScheduleDScheduleMinutesImportRun.update({
      where: { id: created.id }, data: { warnings: warnings as Prisma.InputJsonValue[], autoRegisteredSeibans: { planningBoards: {}, searchHistory: [], metrics } }
    });
  }, { timeout: 30000 });
  if (run.status !== 'SUCCESS') {
    await autoRegisterDScheduleMinutes({ runId: run.id, blocks: input.result.blocks });
  }
  return prisma.productionScheduleDScheduleMinutesImportRun.findUniqueOrThrow({ where: { id: run.id } });
}
