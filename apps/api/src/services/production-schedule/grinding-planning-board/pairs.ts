import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { STATIC_GRINDING_RESOURCE_CDS } from '../policies/resource-category-policy.service.js';
import { STRING_TRIM_CHARACTERS } from './shared.js';

const pairScope = (siteKey: string) => ({ csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey });
const pairSelect = { id: true, firstPartName: true, secondPartName: true } as const;
type PlanningPair = Prisma.ProductionScheduleGrindingPlanningBoardPairGetPayload<{ select: typeof pairSelect }>;

export function readPlanningPairs(siteKey: string) {
  return prisma.productionScheduleGrindingPlanningBoardPair.findMany({
    where: pairScope(siteKey), select: pairSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
}

export async function createPlanningPair(siteKey: string, firstPartName: string, secondPartName: string) {
  if (firstPartName === secondPartName) throw new ApiError(400, '異なる品名を選んでください', undefined, 'SAME_PLANNING_PAIR_PART');
  const scope = pairScope(siteKey);
  const names = [firstPartName, secondPartName];
  try {
    // Serializable protects both columns as one membership check during concurrent inserts.
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.productionScheduleGrindingPlanningBoardPair.findFirst({
        where: { ...scope, OR: [{ firstPartName: { in: names } }, { secondPartName: { in: names } }] },
        select: pairSelect
      });
      if (existing) {
        if (names.includes(existing.firstPartName) && names.includes(existing.secondPartName)) return existing;
        throw new ApiError(409, 'すでに組に入っている品名です', undefined, 'PLANNING_PAIR_PART_IN_USE');
      }
      const present = await tx.$queryRaw<{ partName: string }[]>(Prisma.sql`
        SELECT DISTINCT "rowData"->>'FHINMEI' AS "partName"
        FROM "CsvDashboardRow"
        WHERE "csvDashboardId" = ${scope.csvDashboardId}
          AND "rowData"->>'FHINMEI' IN (${Prisma.join(names)})
      `);
      if (present.length !== 2) throw new ApiError(400, '生産日程の品名を選んでください', undefined, 'UNKNOWN_PLANNING_PAIR_PART');
      return tx.productionScheduleGrindingPlanningBoardPair.create({
        data: { ...scope, firstPartName, secondPartName }, select: pairSelect
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) {
      throw new ApiError(409, '組が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_PAIRS');
    }
    throw error;
  }
}

export async function deletePlanningPair(siteKey: string, id: string) {
  const { count } = await prisma.productionScheduleGrindingPlanningBoardPair.deleteMany({ where: { ...pairScope(siteKey), id } });
  return { deleted: count > 0 };
}

export async function getPlanningPairSuggestions(partName: string) {
  const suggestions = await prisma.$queryRaw<{ partName: string; seibanCount: number }[]>(Prisma.sql`
    WITH grinding_rows AS (
      SELECT BTRIM("rowData"->>'FSEIBAN', ${STRING_TRIM_CHARACTERS}) AS fseiban,
        BTRIM("rowData"->>'FKOJUN', ${STRING_TRIM_CHARACTERS}) AS process_order,
        "rowData"->>'FHINMEI' AS part_name
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "supersededAt" IS NULL
        AND BTRIM("rowData"->>'FSIGENCD', ${STRING_TRIM_CHARACTERS}) IN (${Prisma.join(STATIC_GRINDING_RESOURCE_CDS)})
    ), selected AS (
      SELECT DISTINCT fseiban, process_order FROM grinding_rows
      WHERE part_name = ${partName} AND fseiban NOT IN ('', '********') AND process_order <> ''
    )
    SELECT other.part_name AS "partName", COUNT(DISTINCT other.fseiban)::int AS "seibanCount"
    FROM grinding_rows other JOIN selected USING (fseiban, process_order)
    WHERE other.part_name <> ${partName} AND BTRIM(other.part_name, ${STRING_TRIM_CHARACTERS}) <> ''
    GROUP BY other.part_name
  `);
  return { suggestions: suggestions.sort((a, b) => b.seibanCount - a.seibanCount || a.partName.localeCompare(b.partName, 'ja')) };
}

type PairArrivalItem = Pick<GrindingPlanningBoardItem, 'itemId' | 'fseiban' | 'processOrder' | 'fhinmei' | 'isCompleted' | 'arrived'>;
const pairArrivalKey = (item: PairArrivalItem, partName: string) =>
  JSON.stringify([item.fseiban.trim(), item.processOrder.trim(), partName]);

export function planningPairPartners(pairs: readonly Pick<PlanningPair, 'firstPartName' | 'secondPartName'>[]) {
  return new Map(pairs.flatMap(({ firstPartName, secondPartName }) => [
    [firstPartName, secondPartName] as const, [secondPartName, firstPartName] as const
  ]));
}

export function findWaitingPlanningPairItemIds(items: readonly PairArrivalItem[], counterparts: readonly PairArrivalItem[], partners: ReadonlyMap<string, string>) {
  const counterpartByKey = new Map<string, { allCompleted: boolean; anyArrived: boolean }>();
  for (const item of counterparts) {
    if (!item.fhinmei) continue;
    const key = pairArrivalKey(item, item.fhinmei);
    const previous = counterpartByKey.get(key);
    counterpartByKey.set(key, {
      allCompleted: item.isCompleted && (previous?.allCompleted ?? true),
      anyArrived: item.arrived !== false || (previous?.anyArrived ?? false)
    });
  }
  return new Set(items.filter((item) => {
    const other = item.fhinmei && partners.get(item.fhinmei);
    if (!other || item.arrived === false) return false;
    const counterpart = counterpartByKey.get(pairArrivalKey(item, other));
    return counterpart && !counterpart.allCompleted && !counterpart.anyArrived;
  }).map((item) => item.itemId));
}
