import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { STATIC_GRINDING_RESOURCE_CDS } from '../policies/resource-category-policy.service.js';
import { STRING_TRIM_CHARACTERS } from './shared.js';

const pairScope = (siteKey: string) => ({ csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey });
const pairSelect = { id: true, firstPartCode: true, firstPartName: true, secondPartCode: true, secondPartName: true } as const;
type PlanningPair = Prisma.ProductionScheduleGrindingPlanningBoardPairGetPayload<{ select: typeof pairSelect }>;
type PairPart = { partCode: string; partName: string };
type CountedPairPart = PairPart & { seibanCount: number };
const PAIR_STATUS_NAME_TERMS = ['足', '脚', 'スタンド'] as const;

const grindingRows = Prisma.sql`
  WITH grinding_rows AS (
    SELECT BTRIM("rowData"->>'FSEIBAN', ${STRING_TRIM_CHARACTERS}) AS fseiban,
      BTRIM("rowData"->>'FKOJUN', ${STRING_TRIM_CHARACTERS}) AS process_order,
      BTRIM("rowData"->>'FHINCD', ${STRING_TRIM_CHARACTERS}) AS part_code,
      BTRIM("rowData"->>'FHINMEI', ${STRING_TRIM_CHARACTERS}) AS part_name
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "supersededAt" IS NULL
      AND BTRIM("rowData"->>'FSIGENCD', ${STRING_TRIM_CHARACTERS}) IN (${Prisma.join(STATIC_GRINDING_RESOURCE_CDS)})
  )
`;

export function readPlanningPairs(siteKey: string) {
  return prisma.productionScheduleGrindingPlanningBoardPair.findMany({
    where: pairScope(siteKey), select: pairSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
}

export async function createPlanningPair(siteKey: string, pair: Omit<PlanningPair, 'id'>) {
  const { firstPartCode, firstPartName, secondPartCode, secondPartName } = pair;
  if (firstPartCode === secondPartCode) throw new ApiError(400, '異なる品番を選んでください', undefined, 'SAME_PLANNING_PAIR_PART');
  const scope = pairScope(siteKey);
  const codes = [firstPartCode, secondPartCode];
  try {
    // Serializable protects both columns as one membership check during concurrent inserts.
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.productionScheduleGrindingPlanningBoardPair.findFirst({
        where: { ...scope, OR: [{ firstPartCode: { in: codes } }, { secondPartCode: { in: codes } }] },
        select: pairSelect
      });
      if (existing) {
        if (codes.includes(existing.firstPartCode) && codes.includes(existing.secondPartCode)) return existing;
        throw new ApiError(409, 'すでに組に入っている品番です', undefined, 'PLANNING_PAIR_PART_IN_USE');
      }
      const present = await tx.$queryRaw<PairPart[]>(Prisma.sql`
        ${grindingRows}
        SELECT DISTINCT part_code AS "partCode", part_name AS "partName"
        FROM grinding_rows
        WHERE (part_code, part_name) IN ((${firstPartCode}, ${firstPartName}), (${secondPartCode}, ${secondPartName}))
      `);
      if (present.length !== 2) throw new ApiError(400, '研削の日程にある品番を選んでください', undefined, 'UNKNOWN_PLANNING_PAIR_PART');
      return tx.productionScheduleGrindingPlanningBoardPair.create({
        data: { ...scope, ...pair }, select: pairSelect
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

export async function getPlanningPairCandidates() {
  const parts = await prisma.$queryRaw<PairPart[]>(Prisma.sql`
    ${grindingRows}
    SELECT DISTINCT part_name AS "partName", part_code AS "partCode"
    FROM grinding_rows
    WHERE part_code <> '' AND part_name <> ''
    ORDER BY "partName", "partCode"
  `);
  return { parts };
}

export async function getPlanningPairStatus() {
  const parts = await prisma.$queryRaw<CountedPairPart[]>(Prisma.sql`
    ${grindingRows}
    SELECT part_name AS "partName", part_code AS "partCode",
      COUNT(DISTINCT fseiban) FILTER (WHERE fseiban NOT IN ('', '********'))::int AS "seibanCount"
    FROM grinding_rows
    WHERE part_code <> '' AND part_name LIKE ANY (ARRAY[${Prisma.join(PAIR_STATUS_NAME_TERMS.map((term) => `%${term}%`))}])
    GROUP BY part_name, part_code
    ORDER BY "partName", "partCode"
  `);
  return { parts };
}

export async function getPlanningPairSuggestions(partCode: string) {
  const rows = await prisma.$queryRaw<(CountedPairPart & { selectedName?: string | null })[]>(Prisma.sql`
    ${grindingRows}, selected AS (
      SELECT DISTINCT fseiban, process_order FROM grinding_rows
      WHERE part_code = ${partCode} AND fseiban NOT IN ('', '********') AND process_order <> ''
    )
    SELECT other.part_code AS "partCode", MIN(other.part_name) AS "partName",
      COUNT(DISTINCT other.fseiban)::int AS "seibanCount",
      (SELECT MIN(part_name) FROM grinding_rows WHERE part_code = ${partCode}) AS "selectedName"
    FROM grinding_rows other JOIN selected USING (fseiban, process_order)
    WHERE other.part_code NOT IN ('', ${partCode}) AND other.part_name <> ''
    GROUP BY other.part_code
  `);
  // Equal counts are common when other parts share every serial; prefer the name closest to the selected one.
  const sharedPrefix = (name: string, selected = '') => {
    let length = 0;
    while (length < name.length && name[length] === selected[length]) length += 1;
    return length;
  };
  const suggestions = rows.map(({ selectedName, ...part }) => ({ part, prefix: sharedPrefix(part.partName, selectedName ?? '') }))
    .sort((a, b) => b.part.seibanCount - a.part.seibanCount || b.prefix - a.prefix ||
      a.part.partName.localeCompare(b.part.partName, 'ja') || a.part.partCode.localeCompare(b.part.partCode))
    .map(({ part }) => part);
  return { suggestions };
}

type PairArrivalItem = Pick<GrindingPlanningBoardItem, 'itemId' | 'fseiban' | 'processOrder' | 'fhincd' | 'isCompleted' | 'arrived'>;
const pairArrivalKey = (item: PairArrivalItem, partCode: string) =>
  JSON.stringify([item.fseiban.trim(), item.processOrder.trim(), partCode]);

export function planningPairPartners(pairs: readonly Pick<PlanningPair, 'firstPartCode' | 'secondPartCode'>[]) {
  return new Map(pairs.flatMap(({ firstPartCode, secondPartCode }) => [
    [firstPartCode, secondPartCode] as const, [secondPartCode, firstPartCode] as const
  ]));
}

export function findWaitingPlanningPairItemIds(items: readonly PairArrivalItem[], counterparts: readonly PairArrivalItem[], partners: ReadonlyMap<string, string>) {
  const counterpartByKey = new Map<string, { allCompleted: boolean; anyArrived: boolean }>();
  for (const item of counterparts) {
    const key = pairArrivalKey(item, item.fhincd.trim());
    const previous = counterpartByKey.get(key);
    counterpartByKey.set(key, {
      allCompleted: item.isCompleted && (previous?.allCompleted ?? true),
      anyArrived: item.arrived !== false || (previous?.anyArrived ?? false)
    });
  }
  return new Set(items.filter((item) => {
    const other = partners.get(item.fhincd.trim());
    if (!other || item.arrived === false) return false;
    const counterpart = counterpartByKey.get(pairArrivalKey(item, other));
    return counterpart && !counterpart.allCompleted && !counterpart.anyArrived;
  }).map((item) => item.itemId));
}
