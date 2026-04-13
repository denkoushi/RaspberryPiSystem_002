import { Prisma } from '@prisma/client';
import {
  buildTokenGroupsForSearch,
  normalizePartSearchQuery,
  partSearchTermVariantsForIlike
} from '@raspi-system/part-search-core';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../../production-schedule/row-resolver/index.js';
import { escapeForIlike } from './part-search-normalize.js';
import { resolveFseibansMatchingMachineNameQuery } from './part-search-machine-name-fseibans.service.js';
import type { PartPlacementSearchHitDto, PartPlacementSearchSuggestResult } from './part-search.types.js';

const CURRENT_LIMIT = 30;
const SCHEDULE_LIMIT = 30;

type BranchStateSqlRow = {
  id: string;
  manufacturingOrderBarcodeRaw: string;
  branchNo: number;
  shelfCodeRaw: string;
  csvDashboardRowId: string | null;
  fhinmei: string | null;
  fhincd: string | null;
  fseiban: string | null;
  product_no: string | null;
};

type ScheduleSqlRow = {
  id: string;
  fhinmei: string | null;
  fhincd: string | null;
  fseiban: string | null;
  product_no: string | null;
};

function buildDisplayName(row: {
  fhinmei: string | null;
  fhincd: string | null;
  productNo: string | null;
}): string {
  const mei = (row.fhinmei ?? '').trim();
  if (mei.length > 0) return mei;
  const cd = (row.fhincd ?? '').trim();
  if (cd.length > 0) return cd;
  const pn = (row.productNo ?? '').trim();
  if (pn.length > 0) return pn;
  return '（名称不明）';
}

/** 1 トークン分の OR 条件（FHINMEI / FHINCD のいずれかに部分一致） */
function buildBranchStateWhereClauseForTokenGroup(terms: string[]): Prisma.Sql {
  const parts = terms.flatMap((t) => {
    const variants = partSearchTermVariantsForIlike(t);
    return variants.map((v) => {
      const pattern = `%${escapeForIlike(v)}%`;
      return Prisma.sql`(COALESCE("scheduleSnapshot"->>'FHINMEI','') ILIKE ${pattern} ESCAPE '\\' OR COALESCE("scheduleSnapshot"->>'FHINCD','') ILIKE ${pattern} ESCAPE '\\')`;
    });
  });
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function buildBranchStateWhereClause(tokenGroups: string[][]): Prisma.Sql {
  const groups = tokenGroups.map((g) => buildBranchStateWhereClauseForTokenGroup(g));
  return Prisma.sql`(${Prisma.join(groups, ' AND ')})`;
}

function buildRowDataWhereClauseForTokenGroup(terms: string[]): Prisma.Sql {
  const parts = terms.flatMap((t) => {
    const variants = partSearchTermVariantsForIlike(t);
    return variants.map((v) => {
      const pattern = `%${escapeForIlike(v)}%`;
      return Prisma.sql`(COALESCE(r."rowData"->>'FHINMEI','') ILIKE ${pattern} ESCAPE '\\' OR COALESCE(r."rowData"->>'FHINCD','') ILIKE ${pattern} ESCAPE '\\')`;
    });
  });
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

function buildRowDataWhereClause(tokenGroups: string[][]): Prisma.Sql {
  const groups = tokenGroups.map((g) => buildRowDataWhereClauseForTokenGroup(g));
  return Prisma.sql`(${Prisma.join(groups, ' AND ')})`;
}

function buildExcludedRowIdsClause(excludedIds: string[]): Prisma.Sql {
  if (excludedIds.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql` AND r."id" NOT IN (${Prisma.join(
    excludedIds.map((id) => Prisma.sql`${id}`)
  )})`;
}

function buildFseibanInClauseForBranchState(fseibans: Set<string>): Prisma.Sql {
  const list = [...fseibans];
  if (list.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql` AND COALESCE("scheduleSnapshot"->>'FSEIBAN','') IN (${Prisma.join(
    list.map((v) => Prisma.sql`${v}`),
    ','
  )})`;
}

function buildFseibanInClauseForRowAlias(fseibans: Set<string>): Prisma.Sql {
  const list = [...fseibans];
  if (list.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql` AND COALESCE(r."rowData"->>'FSEIBAN','') IN (${Prisma.join(
    list.map((v) => Prisma.sql`${v}`),
    ','
  )})`;
}

export async function suggestPartPlacementSearch(params: {
  q: string;
  machineName?: string | null;
}): Promise<PartPlacementSearchSuggestResult> {
  const rawQuery = normalizePartSearchQuery(params.q);
  if (rawQuery.length === 0) {
    return { currentPlacements: [], scheduleCandidates: [] };
  }

  const { tokenGroups, aliasMatchedBy } = buildTokenGroupsForSearch(rawQuery);
  if (tokenGroups.length === 0) {
    return { currentPlacements: [], scheduleCandidates: [] };
  }

  const machinePartRaw = (params.machineName ?? '').trim();
  let machineFseibanFilter: Set<string> | null = null;
  if (machinePartRaw.length > 0) {
    machineFseibanFilter = await resolveFseibansMatchingMachineNameQuery(machinePartRaw);
    if (machineFseibanFilter.size === 0) {
      return { currentPlacements: [], scheduleCandidates: [] };
    }
  }

  const branchWhere = buildBranchStateWhereClause(tokenGroups);
  const machineBranchClause = machineFseibanFilter ? buildFseibanInClauseForBranchState(machineFseibanFilter) : Prisma.empty;

  const currentRows = await prisma.$queryRaw<BranchStateSqlRow[]>`
    SELECT
      "id",
      "manufacturingOrderBarcodeRaw",
      "branchNo",
      "shelfCodeRaw",
      "csvDashboardRowId",
      COALESCE("scheduleSnapshot"->>'FHINMEI','') AS fhinmei,
      COALESCE("scheduleSnapshot"->>'FHINCD','') AS fhincd,
      COALESCE("scheduleSnapshot"->>'FSEIBAN','') AS fseiban,
      COALESCE("scheduleSnapshot"->>'ProductNo','') AS product_no
    FROM "OrderPlacementBranchState"
    WHERE ${branchWhere}${machineBranchClause}
    ORDER BY "updatedAt" DESC
    LIMIT ${CURRENT_LIMIT}
  `;

  const excludedScheduleRowIds = currentRows
    .map((r) => r.csvDashboardRowId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const rowWhere = buildRowDataWhereClause(tokenGroups);
  const excludedClause = buildExcludedRowIdsClause(excludedScheduleRowIds);
  const winner = buildMaxProductNoWinnerCondition('r');
  const machineRowClause = machineFseibanFilter ? buildFseibanInClauseForRowAlias(machineFseibanFilter) : Prisma.empty;

  const scheduleRows = await prisma.$queryRaw<ScheduleSqlRow[]>`
    SELECT
      r."id",
      r."rowData"->>'FHINMEI' AS fhinmei,
      r."rowData"->>'FHINCD' AS fhincd,
      r."rowData"->>'FSEIBAN' AS fseiban,
      COALESCE(r."rowData"->>'ProductNo','') AS product_no
    FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${winner}
      AND (${rowWhere})
      ${excludedClause}${machineRowClause}
    ORDER BY r."occurredAt" DESC
    LIMIT ${SCHEDULE_LIMIT}
  `;

  const aliasLabel = aliasMatchedBy;
  const matchedQueryLabel =
    machinePartRaw.length > 0 ? `${rawQuery} ${machinePartRaw}` : rawQuery;

  const currentPlacements: PartPlacementSearchHitDto[] = currentRows.map((row) => {
    const productNo = row.product_no;
    return {
      matchSource: 'current',
      displayName: buildDisplayName({
        fhinmei: row.fhinmei,
        fhincd: row.fhincd,
        productNo
      }),
      matchedQuery: matchedQueryLabel,
      aliasMatchedBy: aliasLabel,
      shelfCodeRaw: row.shelfCodeRaw,
      manufacturingOrderBarcodeRaw: row.manufacturingOrderBarcodeRaw,
      branchNo: row.branchNo,
      branchStateId: row.id,
      csvDashboardRowId: row.csvDashboardRowId,
      fhincd: row.fhincd,
      fhinmei: row.fhinmei,
      fseiban: row.fseiban,
      productNo
    };
  });

  const scheduleCandidates: PartPlacementSearchHitDto[] = scheduleRows.map((row) => {
    const productNo = row.product_no;
    const mo = (productNo ?? '').trim();
    return {
      matchSource: 'schedule',
      displayName: buildDisplayName({
        fhinmei: row.fhinmei,
        fhincd: row.fhincd,
        productNo
      }),
      matchedQuery: matchedQueryLabel,
      aliasMatchedBy: aliasLabel,
      shelfCodeRaw: null,
      manufacturingOrderBarcodeRaw: mo.length > 0 ? mo : null,
      branchNo: null,
      branchStateId: null,
      csvDashboardRowId: row.id,
      fhincd: row.fhincd,
      fhinmei: row.fhinmei,
      fseiban: row.fseiban,
      productNo
    };
  });

  return { currentPlacements, scheduleCandidates };
}
