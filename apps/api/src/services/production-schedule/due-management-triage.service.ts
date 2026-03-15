import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { listEarliestEffectiveDueDateBySeiban } from './due-date-resolution.service.js';
import {
  listDueManagementSummariesWithScope,
  toDueManagementScope,
  type DueManagementLocationScopeInput
} from './due-management-location-scope-adapter.service.js';
import type { DueManagementSummaryItem } from './due-management-query.service.js';
import { getProcessingTypePriority } from './policies/processing-priority-policy.js';
import { buildTriageReasons, type TriageReason } from './policies/triage-reason-policy.js';
import { classifyTriageZone, type TriageZone } from './policies/triage-zone-policy.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

export type DueManagementTriageItem = DueManagementSummaryItem & {
  zone: TriageZone;
  daysUntilDue: number | null;
  reasons: TriageReason[];
  isSelected: boolean;
  topProcessingType: string | null;
};

export type DueManagementTriageResult = {
  zones: Record<TriageZone, DueManagementTriageItem[]>;
};

type TopProcessingTypeRow = {
  fseiban: string;
  processingType: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDayStart = (value: Date): number => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const computeDaysUntilDue = (dueDate: Date | null, now: Date): number | null => {
  if (!dueDate) return null;
  const dueDayStart = toUtcDayStart(dueDate);
  const todayStart = toUtcDayStart(now);
  return Math.floor((dueDayStart - todayStart) / DAY_MS);
};

const compareDueDateAsc = (a: Date | null, b: Date | null): number => {
  if (a && b) return a.getTime() - b.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
};

const extractTopProcessingTypeBySeiban = async (targetFseibans: string[]): Promise<Map<string, string | null>> => {
  if (targetFseibans.length === 0) return new Map<string, string | null>();
  const rows = await prisma.$queryRaw<TopProcessingTypeRow[]>`
    SELECT
      "x"."fseiban" AS "fseiban",
      "x"."processingType" AS "processingType"
    FROM (
      SELECT
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
        COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
        ROW_NUMBER() OVER (
          PARTITION BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
          ORDER BY
            CASE
              WHEN COALESCE("pp"."processingType", "n"."processingType") = 'LSLH' THEN 1
              WHEN COALESCE("pp"."processingType", "n"."processingType") = 'カニゼン' THEN 2
              WHEN COALESCE("pp"."processingType", "n"."processingType") = '塗装' THEN 3
              ELSE 9
            END ASC
        ) AS "rn"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleRowNote" AS "n"
        ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
        ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
      WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(targetFseibans)})
    ) AS "x"
    WHERE "x"."rn" = 1
  `;
  return new Map(rows.map((row) => [row.fseiban, row.processingType] as const));
};

export async function listDueManagementTriage(params: {
  locationScope: DueManagementLocationScopeInput;
  targetFseibans: string[];
  selectedFseibans: string[];
}): Promise<DueManagementTriageResult> {
  const locationScope = toDueManagementScope(params.locationScope);
  const targetSet = new Set(
    params.targetFseibans
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
  const selectedSet = new Set(
    params.selectedFseibans
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
  const summaryRows = await listDueManagementSummariesWithScope(locationScope);
  const effectiveDueDateMap = await listEarliestEffectiveDueDateBySeiban(summaryRows.map((row) => row.fseiban));
  const filteredRows = summaryRows
    .filter((row) => targetSet.has(row.fseiban))
    .map((row) => ({
      ...row,
      dueDate: effectiveDueDateMap.get(row.fseiban) ?? null
    }));
  const topProcessingTypeMap = await extractTopProcessingTypeBySeiban(filteredRows.map((row) => row.fseiban));
  const now = new Date();

  const items: DueManagementTriageItem[] = filteredRows.map((row) => {
    const daysUntilDue = computeDaysUntilDue(row.dueDate, now);
    const topProcessingType = topProcessingTypeMap.get(row.fseiban) ?? null;
    const zone = classifyTriageZone({
      daysUntilDue,
      partsCount: row.partsCount,
      processCount: row.processCount
    });
    const reasons = buildTriageReasons({
      dueDateText: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      daysUntilDue,
      partsCount: row.partsCount,
      processCount: row.processCount,
      topProcessingType
    });
    return {
      ...row,
      zone,
      daysUntilDue,
      reasons,
      isSelected: selectedSet.has(row.fseiban),
      topProcessingType
    };
  });

  const compareItems = (a: DueManagementTriageItem, b: DueManagementTriageItem): number => {
    const dueDateCmp = compareDueDateAsc(a.dueDate, b.dueDate);
    if (dueDateCmp !== 0) return dueDateCmp;
    if (a.processCount !== b.processCount) return b.processCount - a.processCount;
    const aProcessingPriority = getProcessingTypePriority(a.topProcessingType);
    const bProcessingPriority = getProcessingTypePriority(b.topProcessingType);
    if (aProcessingPriority !== bProcessingPriority) return aProcessingPriority - bProcessingPriority;
    return a.fseiban.localeCompare(b.fseiban);
  };

  const zones: Record<TriageZone, DueManagementTriageItem[]> = {
    danger: [],
    caution: [],
    safe: []
  };
  for (const item of items) {
    zones[item.zone].push(item);
  }
  zones.danger.sort(compareItems);
  zones.caution.sort(compareItems);
  zones.safe.sort(compareItems);

  return { zones };
}
