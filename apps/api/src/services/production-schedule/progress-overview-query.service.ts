import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { getResourceCategoryPolicy } from './policies/resource-category-policy.service.js';
import { getProductionScheduleSearchState } from './production-schedule-search-state.service.js';
import { getResourceNameMapByResourceCds } from './resource-master.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type ProgressOverviewRowRaw = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: string;
  processingType: string | null;
  isCompleted: boolean;
};

type SeibanDueDateRow = {
  fseiban: string;
  dueDate: Date;
};

type SeibanProcessingDueDateRow = {
  fseiban: string;
  processingType: string;
  dueDate: Date;
};

export type ProductionScheduleProgressOverviewProcessItem = {
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  processOrder: number | null;
  isCompleted: boolean;
};

export type ProductionScheduleProgressOverviewPartItem = {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  dueDate: Date | null;
  processes: ProductionScheduleProgressOverviewProcessItem[];
};

export type ProductionScheduleProgressOverviewSeibanItem = {
  fseiban: string;
  machineName: string | null;
  dueDate: Date | null;
  parts: ProductionScheduleProgressOverviewPartItem[];
};

export type ProductionScheduleProgressOverviewResult = {
  updatedAt: Date | null;
  registeredFseibans: string[];
  scheduled: ProductionScheduleProgressOverviewSeibanItem[];
  unscheduled: ProductionScheduleProgressOverviewSeibanItem[];
};

const normalizeRegisteredSeibans = (values: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .forEach((value) => {
      if (unique.has(value)) return;
      unique.add(value);
      next.push(value);
    });
  return next;
};

const parseProcessOrder = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const isMachinePartCode = (fhincd: string): boolean => {
  const code = fhincd.trim().toUpperCase();
  return code.startsWith('MH') || code.startsWith('SH');
};

const compareDueDateAsc = (
  a: ProductionScheduleProgressOverviewSeibanItem,
  b: ProductionScheduleProgressOverviewSeibanItem,
  registrationOrder: Map<string, number>
): number => {
  const aTime = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return (registrationOrder.get(a.fseiban) ?? Number.MAX_SAFE_INTEGER) - (registrationOrder.get(b.fseiban) ?? Number.MAX_SAFE_INTEGER);
};

const compareByRegistrationOrder = (
  a: ProductionScheduleProgressOverviewSeibanItem,
  b: ProductionScheduleProgressOverviewSeibanItem,
  registrationOrder: Map<string, number>
): number => (registrationOrder.get(a.fseiban) ?? Number.MAX_SAFE_INTEGER) - (registrationOrder.get(b.fseiban) ?? Number.MAX_SAFE_INTEGER);

const comparePartDueDateAsc = (
  a: ProductionScheduleProgressOverviewPartItem,
  b: ProductionScheduleProgressOverviewPartItem
): number => {
  const aTime = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  if (a.productNo !== b.productNo) return a.productNo.localeCompare(b.productNo);
  return a.fhincd.localeCompare(b.fhincd);
};

export const normalizeProgressOverviewParts = (
  parts: ProductionScheduleProgressOverviewPartItem[]
): ProductionScheduleProgressOverviewPartItem[] => parts.filter((part) => part.processes.length > 0).sort(comparePartDueDateAsc);

export const resolveProgressOverviewResourceNames = (
  resourceCd: string,
  resourceNameMap: Record<string, string[]>
): string[] | undefined => {
  const names = resourceNameMap[resourceCd];
  return names && names.length > 0 ? [...names] : undefined;
};

export const splitProgressOverviewItems = (
  items: ProductionScheduleProgressOverviewSeibanItem[],
  registeredFseibans: string[]
): {
  scheduled: ProductionScheduleProgressOverviewSeibanItem[];
  unscheduled: ProductionScheduleProgressOverviewSeibanItem[];
} => {
  const registrationOrder = new Map(registeredFseibans.map((fseiban, index) => [fseiban, index] as const));
  return {
    scheduled: items
      .filter((item) => item.dueDate !== null)
      .sort((a, b) => compareDueDateAsc(a, b, registrationOrder)),
    unscheduled: items
      .filter((item) => item.dueDate === null)
      .sort((a, b) => compareByRegistrationOrder(a, b, registrationOrder))
  };
};

export async function getProductionScheduleProgressOverview(
  locationKey: string
): Promise<ProductionScheduleProgressOverviewResult> {
  const searchState = await getProductionScheduleSearchState(locationKey);
  const registeredFseibans = normalizeRegisteredSeibans(searchState.state.history);
  if (registeredFseibans.length === 0) {
    return {
      updatedAt: searchState.updatedAt,
      registeredFseibans,
      scheduled: [],
      unscheduled: []
    };
  }

  const [rows, seibanDueDateRows, seibanProcessingDueDateRows, resourceCategoryPolicy] = await Promise.all([
    prisma.$queryRaw<ProgressOverviewRowRaw[]>(Prisma.sql`
      SELECT
        "CsvDashboardRow"."id" AS "rowId",
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
        COALESCE(("CsvDashboardRow"."rowData"->>'ProductNo'), '') AS "productNo",
        COALESCE(("CsvDashboardRow"."rowData"->>'FHINCD'), '') AS "fhincd",
        COALESCE(("CsvDashboardRow"."rowData"->>'FHINMEI'), '') AS "fhinmei",
        COALESCE(("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') AS "fsigencd",
        COALESCE(("CsvDashboardRow"."rowData"->>'FKOJUN'), '') AS "fkojun",
        COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
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
        AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(registeredFseibans)})
      ORDER BY
        ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
        ("CsvDashboardRow"."rowData"->>'FHINCD') ASC,
        (CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END) ASC
    `),
    prisma.$queryRaw<SeibanDueDateRow[]>(Prisma.sql`
      SELECT "fseiban", "dueDate"
      FROM "ProductionScheduleSeibanDueDate"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "fseiban" IN (${Prisma.join(registeredFseibans)})
    `),
    prisma.$queryRaw<SeibanProcessingDueDateRow[]>(Prisma.sql`
      SELECT "fseiban", "processingType", "dueDate"
      FROM "ProductionScheduleSeibanProcessingDueDate"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "fseiban" IN (${Prisma.join(registeredFseibans)})
    `),
    getResourceCategoryPolicy(locationKey)
  ]);

  const excludedResourceCdSet = new Set(
    resourceCategoryPolicy.cuttingExcludedResourceCds.map((value) => value.toUpperCase())
  );
  const resourceNameMap = await getResourceNameMapByResourceCds(rows.map((row) => row.fsigencd));

  const seibanDueDateMap = new Map(seibanDueDateRows.map((row) => [row.fseiban, row.dueDate] as const));
  const processingDueDateMapBySeiban = new Map<string, Map<string, Date>>();
  seibanProcessingDueDateRows.forEach((row) => {
    const key = row.fseiban.trim();
    if (!processingDueDateMapBySeiban.has(key)) {
      processingDueDateMapBySeiban.set(key, new Map<string, Date>());
    }
    processingDueDateMapBySeiban.get(key)?.set(row.processingType, row.dueDate);
  });

  const seibanMap = new Map<
    string,
    {
      fseiban: string;
      machineName: string | null;
      dueDate: Date | null;
      parts: Map<
        string,
        {
          productNo: string;
          fhincd: string;
          fhinmei: string;
          processingType: string | null;
          processes: ProductionScheduleProgressOverviewProcessItem[];
        }
      >;
    }
  >();
  registeredFseibans.forEach((fseiban) => {
    seibanMap.set(fseiban, {
      fseiban,
      machineName: null,
      dueDate: seibanDueDateMap.get(fseiban) ?? null,
      parts: new Map()
    });
  });

  rows.forEach((row) => {
    const fseiban = row.fseiban.trim();
    if (!fseiban) return;
    if (!seibanMap.has(fseiban)) {
      seibanMap.set(fseiban, {
        fseiban,
        machineName: null,
        dueDate: seibanDueDateMap.get(fseiban) ?? null,
        parts: new Map()
      });
    }
    const seibanItem = seibanMap.get(fseiban);
    if (!seibanItem) return;
    const fhincd = row.fhincd.trim();
    if (!fhincd) return;

    if (seibanItem.machineName === null && isMachinePartCode(fhincd) && row.fhinmei.trim().length > 0) {
      seibanItem.machineName = row.fhinmei.trim();
    }

    if (!seibanItem.parts.has(fhincd)) {
      seibanItem.parts.set(fhincd, {
        productNo: row.productNo.trim(),
        fhincd,
        fhinmei: row.fhinmei.trim(),
        processingType: row.processingType?.trim() ?? null,
        processes: []
      });
    }
    const part = seibanItem.parts.get(fhincd);
    if (!part) return;
    if (!part.processingType && row.processingType?.trim()) {
      part.processingType = row.processingType.trim();
    }
    const resourceCd = row.fsigencd.trim();
    if (!resourceCd) {
      return;
    }
    if (excludedResourceCdSet.has(resourceCd.toUpperCase())) {
      return;
    }
    part.processes.push({
      rowId: row.rowId,
      resourceCd,
      resourceNames: resolveProgressOverviewResourceNames(resourceCd, resourceNameMap),
      processOrder: parseProcessOrder(row.fkojun),
      isCompleted: row.isCompleted
    });
  });

  const overviewItems: ProductionScheduleProgressOverviewSeibanItem[] = Array.from(seibanMap.values()).map((seibanItem) => {
    const processingDueDateMap = processingDueDateMapBySeiban.get(seibanItem.fseiban) ?? new Map<string, Date>();
    const parts = normalizeProgressOverviewParts(Array.from(seibanItem.parts.values()).map((part) => {
      const partDueDate = part.processingType ? processingDueDateMap.get(part.processingType) ?? null : null;
      const dueDate = partDueDate ?? seibanItem.dueDate;
      const sortedProcesses = [...part.processes].sort((a, b) => {
        const aOrder = a.processOrder ?? Number.MAX_SAFE_INTEGER;
        const bOrder = b.processOrder ?? Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.rowId.localeCompare(b.rowId);
      });
      return {
        productNo: part.productNo,
        fhincd: part.fhincd,
        fhinmei: part.fhinmei,
        dueDate,
        processes: sortedProcesses
      };
    }));
    return {
      fseiban: seibanItem.fseiban,
      machineName: seibanItem.machineName,
      dueDate: seibanItem.dueDate,
      parts
    };
  });
  const { scheduled, unscheduled } = splitProgressOverviewItems(overviewItems, registeredFseibans);

  return {
    updatedAt: searchState.updatedAt,
    registeredFseibans,
    scheduled,
    unscheduled
  };
}
