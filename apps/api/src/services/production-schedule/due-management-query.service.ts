import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { getResourceCategoryPolicy } from './policies/resource-category-policy.service.js';
import { getProcessingTypePriority } from './policies/processing-priority-policy.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type SeibanSummaryRaw = {
  fseiban: string;
  partsCount: bigint;
  processCount: bigint;
  totalRequiredMinutes: number | null;
  machineName: string | null;
};

type SeibanRowRaw = {
  id: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: string;
  lotQty: string;
  requiredMinutes: string;
  processingType: string | null;
  note: string | null;
  isCompleted: boolean;
};

export type DueManagementSummaryItem = {
  fseiban: string;
  machineName: string | null;
  dueDate: Date | null;
  partsCount: number;
  processCount: number;
  totalRequiredMinutes: number;
  actualEstimatedMinutes: number;
  actualCoverageRatio: number;
};

export type DueManagementPartProcessItem = {
  rowId: string;
  resourceCd: string;
  processOrder: number | null;
  isCompleted: boolean;
};

export type DueManagementPartItem = {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  note: string | null;
  processCount: number;
  totalRequiredMinutes: number;
  processingType: string | null;
  processingPriority: number;
  completedProcessCount: number;
  totalProcessCount: number;
  actualPerPieceMinutes: number | null;
  actualEstimatedMinutes: number;
  actualCoverageRatio: number;
  processes: DueManagementPartProcessItem[];
  currentPriorityRank: number | null;
  suggestedPriorityRank: number;
};

export type DueManagementSeibanDetail = {
  fseiban: string;
  machineName: string | null;
  dueDate: Date | null;
  parts: DueManagementPartItem[];
};

const parseRequiredMinutes = (raw: string): number => {
  const normalized = raw.trim();
  if (normalized.length === 0) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parsePositiveNumber = (raw: string | null | undefined): number | null => {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (normalized.length === 0) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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
      )::double precision AS "totalRequiredMinutes",
      MIN(("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE (
            UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'MH%'
            OR UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) LIKE 'SH%'
          )
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "machineName"
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

  const featureRows = await prisma.productionScheduleActualHoursFeature.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    select: {
      fhincd: true,
      resourceCd: true,
      sampleCount: true,
      medianPerPieceMinutes: true,
      p75PerPieceMinutes: true
    }
  });
  const featureMap = new Map(
    featureRows.map((row) => [
      `${row.fhincd}__${row.resourceCd}`,
      {
        sampleCount: row.sampleCount,
        perPieceMinutes: row.p75PerPieceMinutes ?? row.medianPerPieceMinutes
      }
    ] as const)
  );
  const actualSignalMap = new Map<string, { estimatedMinutes: number; coverageRatio: number }>();
  if (featureMap.size > 0 && summaryRows.length > 0) {
    const fseibanList = Prisma.join(summaryRows.map((row) => Prisma.sql`${row.fseiban}`));
    const rows = await prisma.$queryRaw<
      Array<{ fseiban: string; fhincd: string | null; resourceCd: string | null; lotQty: string | null }>
    >(Prisma.sql`
      SELECT
        "rowData"->>'FSEIBAN' AS "fseiban",
        "rowData"->>'FHINCD' AS "fhincd",
        "rowData"->>'FSIGENCD' AS "resourceCd",
        "rowData"->>'FSEZOSIJISU' AS "lotQty"
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND "rowData"->>'FSEIBAN' IN (${fseibanList})
        AND COALESCE("rowData"->>'FPROGRESS', '') <> '完了'
    `);
    const aggregateMap = new Map<string, { totalRows: number; matchedRows: number; estimatedMinutes: number }>();
    for (const row of rows) {
      const fseiban = row.fseiban?.trim();
      if (!fseiban) continue;
      const current = aggregateMap.get(fseiban) ?? {
        totalRows: 0,
        matchedRows: 0,
        estimatedMinutes: 0
      };
      current.totalRows += 1;
      const fhincd = row.fhincd?.trim() ?? '';
      const resourceCd = row.resourceCd?.trim() ?? '';
      const lotQty = parsePositiveNumber(row.lotQty);
      if (fhincd && resourceCd && lotQty !== null) {
        const feature = featureMap.get(`${fhincd}__${resourceCd}`);
        if (feature) {
          current.matchedRows += 1;
          current.estimatedMinutes += feature.perPieceMinutes * lotQty;
        }
      }
      aggregateMap.set(fseiban, current);
    }
    aggregateMap.forEach((aggregated, fseiban) => {
      actualSignalMap.set(fseiban, {
        estimatedMinutes: aggregated.estimatedMinutes,
        coverageRatio: aggregated.totalRows > 0 ? aggregated.matchedRows / aggregated.totalRows : 0
      });
    });
  }

  return summaryRows.map((row) => ({
    fseiban: row.fseiban,
    machineName: row.machineName,
    dueDate: dueDateMap.get(row.fseiban) ?? null,
    partsCount: Number(row.partsCount),
    processCount: Number(row.processCount),
    totalRequiredMinutes: Number(row.totalRequiredMinutes ?? 0),
    actualEstimatedMinutes: actualSignalMap.get(row.fseiban)?.estimatedMinutes ?? 0,
    actualCoverageRatio: actualSignalMap.get(row.fseiban)?.coverageRatio ?? 0
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
      ("CsvDashboardRow"."rowData"->>'ProductNo') AS "productNo",
      ("CsvDashboardRow"."rowData"->>'FHINCD') AS "fhincd",
      ("CsvDashboardRow"."rowData"->>'FHINMEI') AS "fhinmei",
      ("CsvDashboardRow"."rowData"->>'FSIGENCD') AS "fsigencd",
      ("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
      ("CsvDashboardRow"."rowData"->>'FSEZOSIJISU') AS "lotQty",
      ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') AS "requiredMinutes",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."note" AS "note",
      COALESCE("p"."isCompleted", FALSE) AS "isCompleted"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."location" = ${locationKey}
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."location" = ${locationKey}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
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
  const resourceCategoryPolicy = await getResourceCategoryPolicy(locationKey);
  const excludedResourceCdSet = new Set(resourceCategoryPolicy.cuttingExcludedResourceCds.map((value) => value.toUpperCase()));
  const featureRows = await prisma.productionScheduleActualHoursFeature.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    select: {
      fhincd: true,
      resourceCd: true,
      medianPerPieceMinutes: true,
      p75PerPieceMinutes: true
    }
  });
  const featureMap = new Map(
    featureRows.map((row) => [
      `${row.fhincd}__${row.resourceCd}`,
      row.p75PerPieceMinutes ?? row.medianPerPieceMinutes
    ] as const)
  );

  const grouped = new Map<
    string,
    {
      productNo: string;
      fhincd: string;
      fhinmei: string;
      note: string | null;
      processCount: number;
      totalRequiredMinutes: number;
      processingType: string | null;
      processingPriority: number;
        completedProcessCount: number;
        totalProcessCount: number;
        actualMatchedProcessCount: number;
        actualEstimatedMinutes: number;
        actualLotQty: number;
        processes: DueManagementPartProcessItem[];
    }
  >();
  for (const row of rows) {
    const fhincd = row.fhincd?.trim() ?? '';
    if (fhincd.length === 0) continue;
    const normalizedFhincd = fhincd.toUpperCase();
    if (normalizedFhincd.startsWith('MH') || normalizedFhincd.startsWith('SH')) {
      continue;
    }
    const resourceCd = row.fsigencd?.trim() ?? '';
    if (excludedResourceCdSet.has(resourceCd.toUpperCase())) {
      continue;
    }
    const note = row.note?.trim() ?? '';

    const current = grouped.get(fhincd);
    const processingPriority = getProcessingTypePriority(row.processingType);
    const lotQty = parsePositiveNumber(row.lotQty ?? '');
    const perPieceMinutes = featureMap.get(`${fhincd}__${resourceCd}`) ?? null;
    const rowActualEstimatedMinutes =
      perPieceMinutes !== null && lotQty !== null ? perPieceMinutes * lotQty : 0;
    const isActualMatched = rowActualEstimatedMinutes > 0;
    if (!current) {
      grouped.set(fhincd, {
        productNo: row.productNo?.trim() ?? '',
        fhincd,
        fhinmei: row.fhinmei?.trim() ?? '',
        note: note.length > 0 ? note : null,
        processCount: 1,
        totalRequiredMinutes: parseRequiredMinutes(row.requiredMinutes ?? ''),
        processingType: row.processingType,
        processingPriority,
        completedProcessCount: row.isCompleted ? 1 : 0,
        totalProcessCount: 1,
        actualMatchedProcessCount: isActualMatched ? 1 : 0,
        actualEstimatedMinutes: rowActualEstimatedMinutes,
        actualLotQty: isActualMatched && lotQty !== null ? lotQty : 0,
        processes: [
          {
            rowId: row.id,
            resourceCd: row.fsigencd?.trim() ?? '',
            processOrder: /^\d+$/.test(row.fkojun ?? '') ? Number(row.fkojun) : null,
            isCompleted: row.isCompleted
          }
        ]
      });
      continue;
    }

    if (current.productNo.length === 0) {
      current.productNo = row.productNo?.trim() ?? '';
    }
    if (!current.note && note.length > 0) {
      current.note = note;
    }
    current.processCount += 1;
    current.totalRequiredMinutes += parseRequiredMinutes(row.requiredMinutes ?? '');
    current.totalProcessCount += 1;
    current.actualEstimatedMinutes += rowActualEstimatedMinutes;
    if (isActualMatched) {
      current.actualMatchedProcessCount += 1;
      if (lotQty !== null) {
        current.actualLotQty += lotQty;
      }
    }
    if (row.isCompleted) {
      current.completedProcessCount += 1;
    }
    current.processes.push({
      rowId: row.id,
      resourceCd: row.fsigencd?.trim() ?? '',
      processOrder: /^\d+$/.test(row.fkojun ?? '') ? Number(row.fkojun) : null,
      isCompleted: row.isCompleted
    });
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
      processes: [...part.processes].sort((a, b) => {
        if (a.processOrder !== null && b.processOrder !== null) {
          return a.processOrder - b.processOrder;
        }
        if (a.processOrder !== null) return -1;
        if (b.processOrder !== null) return 1;
        return a.resourceCd.localeCompare(b.resourceCd);
      }),
      actualPerPieceMinutes: part.actualLotQty > 0 ? part.actualEstimatedMinutes / part.actualLotQty : null,
      actualEstimatedMinutes: part.actualEstimatedMinutes,
      actualCoverageRatio: part.totalProcessCount > 0 ? part.actualMatchedProcessCount / part.totalProcessCount : 0,
      currentPriorityRank: currentPriorityMap.get(part.fhincd) ?? null,
      suggestedPriorityRank: index + 1
    }));

  const machineName = rows.find((row) => {
    const normalized = row.fhincd?.trim().toUpperCase() ?? '';
    return (normalized.startsWith('MH') || normalized.startsWith('SH')) && row.fhinmei?.trim().length > 0;
  })?.fhinmei?.trim() ?? null;

  return {
    fseiban,
    machineName,
    dueDate: dueDate?.dueDate ?? null,
    parts
  };
}
