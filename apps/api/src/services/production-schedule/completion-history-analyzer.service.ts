import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type HistoryResourceRow = {
  resourceCd: string;
  completedCount: bigint;
  totalCount: bigint;
  avgRequiredMinutes: number | null;
};

type CandidateResourceRow = {
  fseiban: string;
  resourceCd: string;
  avgRequiredMinutes: number | null;
};

export type CompletionHistorySignal = {
  delayRiskScore: number;
  estimationGapScore: number;
  throughputPenaltyScore: number;
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

const emptySignal = (): CompletionHistorySignal => ({
  delayRiskScore: 0,
  estimationGapScore: 0,
  throughputPenaltyScore: 0
});

export async function analyzeCompletionHistorySignals(params: {
  candidateFseibans: string[];
}): Promise<Map<string, CompletionHistorySignal>> {
  const candidates = normalizeFseibans(params.candidateFseibans);
  const result = new Map<string, CompletionHistorySignal>();
  if (candidates.length === 0) return result;

  const historyRows = await prisma.$queryRaw<HistoryResourceRow[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSIGENCD') AS "resourceCd",
      COUNT(*) FILTER (WHERE COALESCE("p"."isCompleted", FALSE) = TRUE)::bigint AS "completedCount",
      COUNT(*)::bigint AS "totalCount",
      AVG(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "avgRequiredMinutes"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND NULLIF(TRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
    GROUP BY ("CsvDashboardRow"."rowData"->>'FSIGENCD')
  `;

  const candidateRows = await prisma.$queryRaw<CandidateResourceRow[]>`
    SELECT
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      ("CsvDashboardRow"."rowData"->>'FSIGENCD') AS "resourceCd",
      AVG(
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
          ELSE 0
        END
      )::double precision AS "avgRequiredMinutes"
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

  const historyByResource = new Map(
    historyRows.map((row) => {
      const total = Number(row.totalCount);
      const completed = Number(row.completedCount);
      const completionRatio = total > 0 ? completed / total : 0;
      return [
        row.resourceCd.trim().toUpperCase(),
        {
          completionRatio,
          avgRequiredMinutes: Number(row.avgRequiredMinutes ?? 0)
        }
      ] as const;
    })
  );

  const rowsBySeiban = new Map<string, CandidateResourceRow[]>();
  for (const row of candidateRows) {
    const list = rowsBySeiban.get(row.fseiban) ?? [];
    list.push(row);
    rowsBySeiban.set(row.fseiban, list);
  }

  for (const fseiban of candidates) {
    const rows = rowsBySeiban.get(fseiban) ?? [];
    if (rows.length === 0) {
      result.set(fseiban, emptySignal());
      continue;
    }
    let delayRiskScore = 0;
    let estimationGapScore = 0;
    let throughputPenaltyScore = 0;
    for (const row of rows) {
      const resourceCd = row.resourceCd.trim().toUpperCase();
      const history = historyByResource.get(resourceCd);
      const completionRatio = history?.completionRatio ?? 0.5;
      const averageMinutes = Number(row.avgRequiredMinutes ?? 0);
      const baselineMinutes = history?.avgRequiredMinutes ?? averageMinutes;
      delayRiskScore += 1 - completionRatio;
      if (baselineMinutes > 0) {
        estimationGapScore += Math.min(2, Math.abs(averageMinutes - baselineMinutes) / baselineMinutes);
      }
      throughputPenaltyScore += completionRatio < 0.6 ? 1 : 0;
    }
    const divisor = rows.length;
    result.set(fseiban, {
      delayRiskScore: delayRiskScore / divisor,
      estimationGapScore: estimationGapScore / divisor,
      throughputPenaltyScore: throughputPenaltyScore / divisor
    });
  }

  return result;
}
