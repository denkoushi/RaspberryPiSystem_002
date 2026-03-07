import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { getResourceCategoryPolicy } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type ResourceLoadRow = {
  fseiban: string;
  resourceCd: string;
  processCount: bigint;
  totalRequiredMinutes: number | null;
};

export type ResourceLoadSignal = {
  unfinishedProcessCount: number;
  resourceTypeCount: number;
  concentrationRatio: number;
  bottleneckLoadRatio: number;
  crowdedLoadRatio: number;
};

const normalizeFseibans = (items: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next.slice(0, 2000);
};

const emptySignal = (): ResourceLoadSignal => ({
  unfinishedProcessCount: 0,
  resourceTypeCount: 0,
  concentrationRatio: 0,
  bottleneckLoadRatio: 0,
  crowdedLoadRatio: 0
});

export async function estimateResourceLoadSignals(params: {
  locationKey: string;
  candidateFseibans: string[];
}): Promise<Map<string, ResourceLoadSignal>> {
  const candidates = normalizeFseibans(params.candidateFseibans);
  const result = new Map<string, ResourceLoadSignal>();
  if (candidates.length === 0) return result;

  const resourceCategory = await getResourceCategoryPolicy(params.locationKey);
  const excludedSet = new Set(resourceCategory.cuttingExcludedResourceCds.map((value) => value.toUpperCase()));

  const rows = await prisma.$queryRaw<ResourceLoadRow[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      ("CsvDashboardRow"."rowData"->>'FSIGENCD') AS "resourceCd",
      COUNT(*)::bigint AS "processCount",
      SUM(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "totalRequiredMinutes"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(candidates)})
      AND COALESCE("p"."isCompleted", FALSE) = FALSE
      AND NULLIF(TRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSEIBAN'), ("CsvDashboardRow"."rowData"->>'FSIGENCD')
  `;

  const rowsBySeiban = new Map<string, ResourceLoadRow[]>();
  const resourceTotals = new Map<string, number>();
  for (const row of rows) {
    const normalizedCd = row.resourceCd.trim().toUpperCase();
    if (!normalizedCd || excludedSet.has(normalizedCd)) continue;
    const list = rowsBySeiban.get(row.fseiban) ?? [];
    list.push(row);
    rowsBySeiban.set(row.fseiban, list);
    const required = Number(row.totalRequiredMinutes ?? 0);
    resourceTotals.set(normalizedCd, (resourceTotals.get(normalizedCd) ?? 0) + required);
  }

  const crowdedThreshold = (() => {
    const values = Array.from(resourceTotals.values()).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const idx = Math.max(0, Math.floor(values.length * 0.75) - 1);
    return values[idx] ?? values[values.length - 1] ?? 0;
  })();

  for (const fseiban of candidates) {
    const ownRows = rowsBySeiban.get(fseiban) ?? [];
    if (ownRows.length === 0) {
      result.set(fseiban, emptySignal());
      continue;
    }
    let totalRequired = 0;
    let maxRequired = 0;
    let unfinishedProcessCount = 0;
    let crowdedRequired = 0;
    for (const row of ownRows) {
      const required = Number(row.totalRequiredMinutes ?? 0);
      const processCount = Number(row.processCount);
      const normalizedCd = row.resourceCd.trim().toUpperCase();
      totalRequired += required;
      unfinishedProcessCount += processCount;
      maxRequired = Math.max(maxRequired, required);
      if ((resourceTotals.get(normalizedCd) ?? 0) >= crowdedThreshold && crowdedThreshold > 0) {
        crowdedRequired += required;
      }
    }
    const bottleneckTotal = Math.max(...Array.from(resourceTotals.values()), 0);
    result.set(fseiban, {
      unfinishedProcessCount,
      resourceTypeCount: ownRows.length,
      concentrationRatio: totalRequired > 0 ? maxRequired / totalRequired : 0,
      bottleneckLoadRatio: bottleneckTotal > 0 ? maxRequired / bottleneckTotal : 0,
      crowdedLoadRatio: totalRequired > 0 ? crowdedRequired / totalRequired : 0
    });
  }

  return result;
}
