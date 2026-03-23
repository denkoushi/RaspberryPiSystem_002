import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { loadActualHoursReadContext } from './actual-hours/actual-hours-read-context.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd
} from './policies/resource-category-policy.service.js';
import { getProcessingTypePriority } from './policies/processing-priority-policy.js';
import {
  getResourceNameMapByResourceCds
} from './resource-master.service.js';
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
  resourceNames: string[];
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
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
    },
    select: {
      fseiban: true,
      dueDate: true
    }
  });
  const dueDateMap = new Map(dueDateRows.map((row) => [row.fseiban, row.dueDate] as const));

  const actualSignalMap = new Map<string, { estimatedMinutes: number; coverageRatio: number }>();
  if (summaryRows.length > 0) {
    const fseibanList = Prisma.join(summaryRows.map((row) => Prisma.sql`${row.fseiban}`));
    const rows = await prisma.$queryRaw<
      Array<{ fseiban: string; fhincd: string | null; resourceCd: string | null }>
    >(Prisma.sql`
      SELECT
        "rowData"->>'FSEIBAN' AS "fseiban",
        "rowData"->>'FHINCD' AS "fhincd",
        "rowData"->>'FSIGENCD' AS "resourceCd"
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
        AND "rowData"->>'FSEIBAN' IN (${fseibanList})
        AND COALESCE("rowData"->>'FPROGRESS', '') <> '完了'
    `);
    const actualHoursReadContext = await loadActualHoursReadContext({
      locationKey,
      resourceCds: rows.map((row) => row.resourceCd?.trim() ?? '').filter((resourceCd) => resourceCd.length > 0)
    });
    // #region agent log
    void fetch('http://127.0.0.1:7242/ingest/57ffe573-8750-493d-b168-a6f5796123fd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07ef10'},body:JSON.stringify({sessionId:'07ef10',runId:'actual-hours-display-pre',hypothesisId:'H3',location:'due-management-query.service.ts:listDueManagementSummaries:184',message:'actual-hours feature rows fetched for due summary',data:{locationKey,actualHoursLocationCandidates:actualHoursReadContext.locationCandidates,summaryRows:summaryRows.length,featureRowsSelected:actualHoursReadContext.selectedFeatureCount,resourceCodeMappings:actualHoursReadContext.resourceCodeMappingCount,summaryFetchedFeatureCountsByLocation:actualHoursReadContext.fetchedFeatureCountByLocation},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const aggregateMap = new Map<string, { totalRows: number; matchedRows: number }>();
    for (const row of rows) {
      const fseiban = row.fseiban?.trim();
      if (!fseiban) continue;
      const current = aggregateMap.get(fseiban) ?? {
        totalRows: 0,
        matchedRows: 0
      };
      current.totalRows += 1;
      const fhincd = row.fhincd?.trim() ?? '';
      const resourceCd = row.resourceCd?.trim() ?? '';
      if (fhincd && resourceCd) {
        const resolved = actualHoursReadContext.resolver.resolve({ fhincd, resourceCd });
        if (resolved.perPieceMinutes !== null) {
          current.matchedRows += 1;
        }
      }
      aggregateMap.set(fseiban, current);
    }
    aggregateMap.forEach((aggregated, fseiban) => {
      actualSignalMap.set(fseiban, {
        estimatedMinutes: 0,
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
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
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
      csvDashboardId_fseiban: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
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
  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    deviceScopeKey: locationKey
  });
  const detailActualHoursReadContext = await loadActualHoursReadContext({
    locationKey,
    resourceCds: rows.map((row) => row.fsigencd ?? '')
  });
  // #region agent log
  void fetch('http://127.0.0.1:7242/ingest/57ffe573-8750-493d-b168-a6f5796123fd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07ef10'},body:JSON.stringify({sessionId:'07ef10',runId:'actual-hours-display-pre',hypothesisId:'H5',location:'due-management-query.service.ts:getDueManagementSeibanDetail:355',message:'actual-hours feature rows fetched for seiban detail',data:{locationKey,fseiban,actualHoursLocationCandidates:detailActualHoursReadContext.locationCandidates,detailRows:rows.length,featureRowsSelected:detailActualHoursReadContext.selectedFeatureCount,resourceCodeMappings:detailActualHoursReadContext.resourceCodeMappingCount,detailFetchedFeatureCountsByLocation:detailActualHoursReadContext.fetchedFeatureCountByLocation},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const resourceNameMap = await getResourceNameMapByResourceCds(rows.map((row) => row.fsigencd ?? ''));

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
      actualPerPieceMinutesSum: number;
      actualPerPieceSampleCount: number;
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
    if (isProductionScheduleExcludedCuttingResourceCd(resourceCd, resourceCategoryPolicy)) {
      continue;
    }
    const note = row.note?.trim() ?? '';

    const current = grouped.get(fhincd);
    const processingPriority = getProcessingTypePriority(row.processingType);
    const perPieceMinutes = detailActualHoursReadContext.resolver.resolve({ fhincd, resourceCd }).perPieceMinutes;
    const isActualMatched = perPieceMinutes !== null;
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
        actualPerPieceMinutesSum: perPieceMinutes ?? 0,
        actualPerPieceSampleCount: isActualMatched ? 1 : 0,
        processes: [
          {
            rowId: row.id,
            resourceCd: resourceCd,
            resourceNames: resourceNameMap[resourceCd] ?? [],
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
    if (isActualMatched) {
      current.actualMatchedProcessCount += 1;
      current.actualPerPieceMinutesSum += perPieceMinutes ?? 0;
      current.actualPerPieceSampleCount += 1;
    }
    if (row.isCompleted) {
      current.completedProcessCount += 1;
    }
    current.processes.push({
      rowId: row.id,
      resourceCd: resourceCd,
      resourceNames: resourceNameMap[resourceCd] ?? [],
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
      actualPerPieceMinutes:
        part.actualPerPieceSampleCount > 0 ? part.actualPerPieceMinutesSum / part.actualPerPieceSampleCount : null,
      actualEstimatedMinutes: 0,
      actualCoverageRatio: part.totalProcessCount > 0 ? part.actualMatchedProcessCount / part.totalProcessCount : 0,
      currentPriorityRank: currentPriorityMap.get(part.fhincd) ?? null,
      suggestedPriorityRank: index + 1
    }));
  const detailMatchedParts = parts.filter((part) => part.actualPerPieceMinutes !== null).length;
  // #region agent log
  void fetch('http://127.0.0.1:7242/ingest/57ffe573-8750-493d-b168-a6f5796123fd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07ef10'},body:JSON.stringify({sessionId:'07ef10',runId:'actual-hours-display-pre',hypothesisId:'H5',location:'due-management-query.service.ts:getDueManagementSeibanDetail:491',message:'actual-hours resolved result for seiban detail',data:{locationKey,fseiban,totalParts:parts.length,matchedParts:detailMatchedParts,unmatchedParts:parts.length-detailMatchedParts},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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
