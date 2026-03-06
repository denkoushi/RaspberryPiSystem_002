import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { getProcessingTypePriority } from './policies/processing-priority-policy.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type SeibanSummaryRaw = {
  fseiban: string;
  partsCount: bigint;
  processCount: bigint;
  totalRequiredMinutes: number | null;
};

type SeibanRowRaw = {
  id: string;
  fseiban: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: string;
  requiredMinutes: string;
  processingType: string | null;
};

export type DueManagementSummaryItem = {
  fseiban: string;
  dueDate: Date | null;
  partsCount: number;
  processCount: number;
  totalRequiredMinutes: number;
};

export type DueManagementPartItem = {
  fhincd: string;
  fhinmei: string;
  processCount: number;
  totalRequiredMinutes: number;
  processingType: string | null;
  processingPriority: number;
  currentPriorityRank: number | null;
  suggestedPriorityRank: number;
};

export type DueManagementSeibanDetail = {
  fseiban: string;
  dueDate: Date | null;
  parts: DueManagementPartItem[];
};

const parseRequiredMinutes = (raw: string): number => {
  const normalized = raw.trim();
  if (normalized.length === 0) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function listDueManagementSummaries(locationKey: string): Promise<DueManagementSummaryItem[]> {
  const summaryRows = await prisma.$queryRaw<SeibanSummaryRaw[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      COUNT(DISTINCT ("CsvDashboardRow"."rowData"->>'FHINCD'))::bigint AS "partsCount",
      COUNT(*)::bigint AS "processCount",
      SUM(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "totalRequiredMinutes"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND NULLIF(TRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IS NOT NULL
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN')
    ORDER BY ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC
  `;

  const dueDateRows = await prisma.productionScheduleSeibanDueDate.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    select: {
      fseiban: true,
      dueDate: true
    }
  });
  const dueDateMap = new Map(dueDateRows.map((row) => [row.fseiban, row.dueDate] as const));

  return summaryRows.map((row) => ({
    fseiban: row.fseiban,
    dueDate: dueDateMap.get(row.fseiban) ?? null,
    partsCount: Number(row.partsCount),
    processCount: Number(row.processCount),
    totalRequiredMinutes: Number(row.totalRequiredMinutes ?? 0)
  }));
}

export async function getDueManagementSeibanDetail(params: {
  locationKey: string;
  fseiban: string;
}): Promise<DueManagementSeibanDetail> {
  const { locationKey, fseiban } = params;
  const rows = await prisma.$queryRaw<SeibanRowRaw[]>`
    SELECT
      "CsvDashboardRow"."id",
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      ("CsvDashboardRow"."rowData"->>'FHINCD') AS "fhincd",
      ("CsvDashboardRow"."rowData"->>'FHINMEI') AS "fhinmei",
      ("CsvDashboardRow"."rowData"->>'FSIGENCD') AS "fsigencd",
      ("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
      ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') AS "requiredMinutes",
      "n"."processingType" AS "processingType"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."location" = ${locationKey}
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${fseiban}
    ORDER BY
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC
  `;

  const dueDate = await prisma.productionScheduleSeibanDueDate.findUnique({
    where: {
      csvDashboardId_location_fseiban: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        fseiban
      }
    },
    select: {
      dueDate: true
    }
  });

  const priorityRows = await prisma.productionSchedulePartPriority.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      fseiban
    },
    select: {
      fhincd: true,
      priorityRank: true
    }
  });
  const currentPriorityMap = new Map(priorityRows.map((row) => [row.fhincd, row.priorityRank] as const));

  const grouped = new Map<
    string,
    {
      fhincd: string;
      fhinmei: string;
      processCount: number;
      totalRequiredMinutes: number;
      processingType: string | null;
      processingPriority: number;
    }
  >();
  for (const row of rows) {
    const fhincd = row.fhincd?.trim() ?? '';
    if (fhincd.length === 0) continue;

    const current = grouped.get(fhincd);
    const processingPriority = getProcessingTypePriority(row.processingType);
    if (!current) {
      grouped.set(fhincd, {
        fhincd,
        fhinmei: row.fhinmei?.trim() ?? '',
        processCount: 1,
        totalRequiredMinutes: parseRequiredMinutes(row.requiredMinutes ?? ''),
        processingType: row.processingType,
        processingPriority
      });
      continue;
    }

    current.processCount += 1;
    current.totalRequiredMinutes += parseRequiredMinutes(row.requiredMinutes ?? '');
    if (processingPriority < current.processingPriority) {
      current.processingPriority = processingPriority;
      current.processingType = row.processingType;
    }
  }

  const parts = Array.from(grouped.values())
    .sort((a, b) => {
      if (a.processingPriority !== b.processingPriority) {
        return a.processingPriority - b.processingPriority;
      }
      if (a.processCount !== b.processCount) {
        return b.processCount - a.processCount;
      }
      if (a.totalRequiredMinutes !== b.totalRequiredMinutes) {
        return b.totalRequiredMinutes - a.totalRequiredMinutes;
      }
      return a.fhincd.localeCompare(b.fhincd);
    })
    .map((part, index) => ({
      ...part,
      currentPriorityRank: currentPriorityMap.get(part.fhincd) ?? null,
      suggestedPriorityRank: index + 1
    }));

  return {
    fseiban,
    dueDate: dueDate?.dueDate ?? null,
    parts
  };
}
