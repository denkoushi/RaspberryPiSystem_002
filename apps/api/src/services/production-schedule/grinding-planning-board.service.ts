import { createHash } from 'node:crypto';

import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardDueRequest,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardLoad,
  GrindingPlanningBoardOverridesResponse,
  GrindingPlanningBoardRankResponse,
  GrindingPlanningBoardResourceOrderRequest,
  GrindingPlanningBoardResourceOrderResponse,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardSpecialDueKind,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';

import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard/leaderboard-shell-snapshot.store.js';
import { createInMemoryLeaderboardShellSnapshotStore } from './leaderboard/leaderboard-shell-snapshot.store.js';
import { chunkLeaderboardRowIdsForHydrate } from './leaderboard/leaderboard-display-row-scope.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from './leaderboard/leaderboard-shell-hydrate.service.js';
import type { LeaderboardScheduleRowSql } from './leaderboard/leaderboard-schedule-row.types.js';
import { loadLeaderboardCanonicalRows } from './leaderboard/leaderboard-canonical-row-cache.js';
import { readLeaderboardShellSnapshotGenerationToken } from './leaderboard/leaderboard-shell-snapshot-generation.js';
import { prepareProductionScheduleDashboardFilters } from './production-schedule-query/filters.js';
import { fetchLeaderboardPlanningScopedParentRowIds } from './leaderboard/leaderboard-row-selection.service.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleCuttingResourceCd,
  isProductionScheduleGrindingResourceCd,
  normalizeProductionScheduleResourceCd
} from './policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from './row-resolver/constants.js';
import { isProductionScheduleOrderSplitEnabled } from './order-split/production-schedule-order-split-feature.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './order-split/production-schedule-parent-row-lock.service.js';
import {
  projectGrindingPlanningBoard,
  buildGrindingPlanningBoardLogicalKey as buildProjectionLogicalKey,
  buildGrindingPlanningBoardRowItemId,
  resolveGrindingPlanningBoardParentDueDate,
  sortGrindingPlanningBoardProjectionItems,
  type GrindingPlanningBoardProjectionRanks,
  type GrindingPlanningBoardProgressRow,
  type GrindingPlanningBoardProjectionRow,
  type GrindingPlanningBoardProjectionRowDetail
} from './grinding-planning-board-projection.js';
import { readGrindingPlanningBoardLoadSummary } from './grinding-planning-board-load-summary.js';
import { buildWorkCalendarModeMap, listLoadBalancingWorkCalendarsResolved } from './load-balancing/load-balancing-settings.service.js';
import { DEFAULT_WORK_CALENDAR_MODE, type WorkCalendarMode } from './load-balancing/work-calendar-policy.js';
import { resolveSeibanMachineDisplayNamesBatched } from './seiban-machine-display-names.service.js';
import {
  isGrindingPlanningBoardSpecialDueKind,
  resolveGrindingPlanningBoardSpecialDueExpiresAt
} from './grinding-planning-board-special-due.js';
import {
  resolveLeaderboardMaterializedBaseWhere
} from './row-resolver/index.js';

const DEFAULT_PAGE_SIZE = 160;
const MAX_PAGE_SIZE = 160;
const MAX_ALTERNATE_RANK = 2_147_483_647;
const SPLIT_PREFIX = 'split:';
const PLANNING_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
const fallbackPlanningSnapshotStore = createInMemoryLeaderboardShellSnapshotStore({
  defaultTtlMs: PLANNING_SNAPSHOT_TTL_MS
});

type DbClient = Prisma.TransactionClient | typeof prisma;
type RowData = Record<string, unknown>;
type WinnerRow = GrindingPlanningBoardProjectionRow;
type RowDetail = GrindingPlanningBoardProjectionRowDetail;
type RankRow = {
  csvDashboardRowId: string;
  resourceCd: string;
  orderNumber: number;
  updatedAt: Date;
  siteKey: string;
  location: string;
};
type SplitRankRow = {
  splitId: string;
  resourceCd: string;
  orderNumber: number;
  updatedAt: Date;
  siteKey: string;
  location: string;
};
type PlanningState = {
  id: string;
  version: number;
  updatedAt?: Date | null;
  seibanOrder: Prisma.JsonValue;
};
type PlanningSnapshotGenerationDetails = {
  generationToken: string;
  leaderboardGenerationToken: string;
  boardVersion: number;
  boardUpdatedAt: string;
};
type CurrentProjection = {
  state: PlanningState;
  byItemId: Map<string, GrindingPlanningBoardItem>;
  overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>;
  rows: WinnerRow[];
  details: Map<string, RowDetail>;
  ranks: GrindingPlanningBoardProjectionRanks;
  progressRows: GrindingPlanningBoardProgressRow[];
  splitEnabled: boolean;
  policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>;
  sourceRowIds: Map<string, string>;
  masterResourceCds: Set<string>;
  parentEffectiveDueBySourceRow: Map<string, string | null>;
  splitOriginalDueByItemId: Map<string, string | null>;
};

function asRowData(value: unknown): RowData {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as RowData : {};
}

function valueAsString(data: RowData, key: string): string {
  const value = data[key];
  return value == null ? '' : String(value);
}

export function buildGrindingPlanningBoardLogicalKey(rowData: RowData): string {
  return buildProjectionLogicalKey(rowData);
}

export function buildGrindingPlanningBoardItemId(rowData: RowData): string {
  return buildGrindingPlanningBoardRowItemId(rowData);
}

function decodeRowItemId(itemId: string): string | null {
  if (!itemId.startsWith('row:')) return null;
  try {
    const parsed = JSON.parse(Buffer.from(itemId.slice(4), 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.length) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function ymd(value: Date | null | undefined): string | null {
  return value == null ? null : value.toISOString().slice(0, 10);
}

function dateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromYmd(value);
  return !Number.isNaN(date.getTime()) && ymd(date) === value;
}

function todayJstYmd(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function resolvePlanningBoardDueRequest(params: {
  request: GrindingPlanningBoardDueRequest;
  currentEffectiveDueDate: string | null;
  originalDueDate: string | null;
}): Date | null | undefined {
  if (params.request.kind === 'restore') return null;
  if (params.request.kind === 'date') {
    if (!isYmd(params.request.date)) throw new ApiError(400, '納期はYYYY-MM-DDで指定してください', undefined, 'INVALID_DUE_DATE');
    if (params.request.date === params.currentEffectiveDueDate) return undefined;
    if (params.currentEffectiveDueDate != null && params.request.date < params.currentEffectiveDueDate) {
      throw new ApiError(400, '納期の前倒しは指定できません', undefined, 'PAST_DUE_DATE');
    }
    if (params.currentEffectiveDueDate == null && params.request.date < todayJstYmd()) throw new ApiError(400, '過去の日付は指定できません', undefined, 'PAST_DUE_DATE');
    return dateFromYmd(params.request.date);
  }
  if (!Number.isSafeInteger(params.request.days) || params.request.days <= 0) {
    throw new ApiError(400, '延期日数は1以上の整数で指定してください', undefined, 'INVALID_DUE_OFFSET');
  }
  const base = dateFromYmd(params.currentEffectiveDueDate ?? params.originalDueDate ?? todayJstYmd());
  base.setUTCDate(base.getUTCDate() + params.request.days);
  return base;
}

function normalizeUniqueFseibans(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueFseibans(values: readonly string[]): string[] {
  return normalizeUniqueFseibans(values).slice(0, KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
}

function isCategoryResource(resourceCd: string | null, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): boolean {
  if (!resourceCd) return false;
  return category === 'grinding' ? isProductionScheduleGrindingResourceCd(resourceCd, policy) : isProductionScheduleCuttingResourceCd(resourceCd, policy);
}

async function readWinnerRows(client: DbClient = prisma): Promise<WinnerRow[]> {
  return readWinnerRowsScoped(client);
}

async function readWinnerRowsByIds(client: DbClient, rowIds: readonly string[]): Promise<WinnerRow[]> {
  return readWinnerRowsScoped(client, rowIds);
}

async function readWinnerRowsByFseibans(client: DbClient, fseibans: readonly string[]): Promise<WinnerRow[]> {
  const values = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0) return [];
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(client);
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE ${baseWhere}
      AND "CsvDashboardRow"."rowData"->>'FSEIBAN' = ANY(${values}::text[])
  `);
}

async function readWinnerRowsScoped(client: DbClient, rowIds?: readonly string[]): Promise<WinnerRow[]> {
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(client);
  const scope = rowIds === undefined
    ? Prisma.empty
    : rowIds.length === 0
      ? Prisma.sql`AND FALSE`
      : Prisma.sql`AND "CsvDashboardRow"."id"::text = ANY(${[...new Set(rowIds)]}::text[])`;
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE ${baseWhere} ${scope}
  `);
}

export function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (text.length === 0) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00.000Z`
    : /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text)
      ? text
      : `${text}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function planningDetailToRowDetail(row: LeaderboardScheduleRowSql): RowDetail {
  const detail = row.planningDetail;
  const updatedAt = row.updatedAt;
  if (!detail) {
    return {
      updatedAt,
      rowNotes: [{ dueDate: row.dueDate }],
      orderSupplements: [{ plannedQuantity: row.plannedQuantity, plannedEndDate: row.plannedEndDate }],
      productionScheduleProgress: { isCompleted: false, updatedAt: updatedAt ?? new Date(0) },
      productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: updatedAt ?? new Date(0) },
      orderSplits: []
    };
  }
  return {
    updatedAt,
    rowNotes: [{ dueDate: dateValue(detail.dueDate) }],
    orderSupplements: [{ plannedQuantity: detail.plannedQuantity, plannedEndDate: dateValue(detail.plannedEndDate) }],
    productionScheduleProgress: { isCompleted: Boolean(detail.isCompleted), updatedAt: dateValue(detail.progressUpdatedAt) ?? new Date(0) },
    productionScheduleExternalCompletion: { isExternallyCompleted: Boolean(detail.isExternallyCompleted), updatedAt: dateValue(detail.externalUpdatedAt) ?? new Date(0) },
    orderSplits: detail.splits.flatMap((split) => {
      const splitUpdatedAt = dateValue(split.updatedAt);
      if (!splitUpdatedAt) return [];
      return [{ id: split.id, splitQuantity: split.splitQuantity, dueDate: dateValue(split.dueDate), updatedAt: splitUpdatedAt }];
    })
  };
}

type PlanningSource = {
  baseWhere: Prisma.Sql;
  generationToken: string;
  rows: WinnerRow[];
  details: Map<string, RowDetail>;
  progressRows: GrindingPlanningBoardProgressRow[];
};

async function readPlanningSource(params: {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  fseibans: readonly string[];
  leaderboardGenerationToken?: string;
}): Promise<PlanningSource> {
  const generationToken = params.leaderboardGenerationToken ?? await readLeaderboardShellSnapshotGenerationToken();
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(prisma);
  const order = uniqueFseibans(params.fseibans);
  if (order.length === 0) {
    return { baseWhere, generationToken, rows: [], details: new Map(), progressRows: [] };
  }

  // Reuse the existing winner/category selection path, but apply the registered
  // seiban scope before reading any parent rows. This deliberately selects IDs
  // only; full row hydration is delegated to the shared canonical cache path.
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: [],
    assignedOnlyCds: [],
    resourceCategory: params.category,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.siteKey,
    siteKey: params.siteKey,
    planningFseibans: order
  });
  if (filters.kind === 'blocked_empty_search') {
    return { baseWhere, generationToken, rows: [], details: new Map(), progressRows: [] };
  }
  const orderedRowIds = await fetchLeaderboardPlanningScopedParentRowIds({
    leaderboardMaterializedBaseWhere: baseWhere,
    queryWhere: filters.queryWhere,
    completionFilter: 'all'
  });
  // Progress denominators are based on every registered process row. Keep the
  // displayed source category scoped, but use the same canonical ID selector
  // and bounded hydrate/cache path for the registered seiban progress source.
  const progressFilters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: [],
    assignedOnlyCds: [],
    resourceCategory: undefined,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.siteKey,
    siteKey: params.siteKey,
    planningFseibans: order
  });
  const progressRowIds = progressFilters.kind === 'blocked_empty_search'
    ? []
    : await fetchLeaderboardPlanningScopedParentRowIds({
        leaderboardMaterializedBaseWhere: baseWhere,
        queryWhere: progressFilters.queryWhere,
        completionFilter: 'all'
      });
  const cacheKey = { siteKey: params.siteKey, generationToken };

  const identityRows = await loadLeaderboardCanonicalRows({
    key: { ...cacheKey, rankContext: 'none' },
    rowIds: orderedRowIds,
    coverage: 'identity',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
        includeRank: false,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const plannedRows = await loadLeaderboardCanonicalRows({
    key: cacheKey,
    rowIds: orderedRowIds,
    coverage: 'planning',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
        includePlanningDetails: true,
        includeRank: false,
        planningSource: true,
        planningDetailsOnly: true,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const details = new Map(plannedRows.map((row) => [row.id, planningDetailToRowDetail(row)]));
  const progressRowsWithDetails = await loadLeaderboardCanonicalRows({
    key: cacheKey,
    rowIds: progressRowIds,
    coverage: 'planning',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
        includePlanningDetails: true,
        includeRank: false,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const progressDetails = new Map(progressRowsWithDetails.map((row) => [row.id, planningDetailToRowDetail(row)]));
  const progressPolicy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  return {
    baseWhere,
    generationToken,
    rows: identityRows.map((row) => ({ id: row.id, rowData: row.rowData, updatedAt: row.updatedAt })),
    details,
    progressRows: buildPlanningProgressRows(progressRowsWithDetails, progressDetails, progressPolicy.cuttingExcludedResourceCds)
  };
}

function buildPlanningProgressRows(
  rows: readonly WinnerRow[],
  details: ReadonlyMap<string, RowDetail>,
  cuttingExcludedResourceCds: readonly string[]
): GrindingPlanningBoardProgressRow[] {
  return rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const data = asRowData(row.rowData);
    const fhincd = valueAsString(data, 'FHINCD').trim().toUpperCase();
    const resourceCd = normalizeProductionScheduleResourceCd(valueAsString(data, 'FSIGENCD'));
    // Keep progress population aligned with the existing due-management rule:
    // machine rows and excluded cutting resources are not process parts.
    if (fhincd.startsWith('MH') || fhincd.startsWith('SH') || (resourceCd != null && cuttingExcludedResourceCds.includes(resourceCd))) return [];
    return [{
      rowId: row.id,
      fseiban: valueAsString(data, 'FSEIBAN'),
      productNo: valueAsString(data, 'ProductNo'),
      fhincd: valueAsString(data, 'FHINCD'),
      isCompleted: Boolean(detail.productionScheduleProgress?.isCompleted || detail.productionScheduleExternalCompletion?.isExternallyCompleted)
    }];
  });
}

async function readRowDetails(client: DbClient, rowIds: readonly string[]): Promise<Map<string, RowDetail>> {
  if (rowIds.length === 0) return new Map();
  const details = new Map<string, RowDetail>();
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    const rows = await client.csvDashboardRow.findMany({
      where: { id: { in: chunk }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: {
        id: true,
        updatedAt: true,
        rowNotes: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { updatedAt: 'desc' }, take: 1, select: { dueDate: true } },
        orderSupplements: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { plannedQuantity: true, plannedEndDate: true } },
        productionScheduleProgress: { select: { isCompleted: true, updatedAt: true } },
        productionScheduleExternalCompletion: { select: { isExternallyCompleted: true, updatedAt: true } },
        orderSplits: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { id: true, splitQuantity: true, dueDate: true, updatedAt: true }, orderBy: { splitNo: 'asc' } }
      }
    });
    for (const detail of rows) details.set(detail.id, detail as RowDetail);
  }
  return details;
}

async function readRanks(client: DbClient, rowIds: readonly string[], splitIds: readonly string[], siteKey: string): Promise<GrindingPlanningBoardProjectionRanks> {
  const rows: RankRow[] = [];
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    rows.push(...await client.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: chunk }, OR: [{ siteKey }, { location: siteKey }] },
      select: { csvDashboardRowId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
    }));
  }
  const splits: SplitRankRow[] = [];
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(splitIds)])) {
    splits.push(...await client.productionScheduleOrderSplitAssignment.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, splitId: { in: chunk }, OR: [{ siteKey }, { location: siteKey }] },
      select: { splitId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
    }));
  }
  const preferred = (candidate: { location: string; updatedAt: Date }, current: { location: string; updatedAt: Date }) => {
    const candidateRank = candidate.location === siteKey ? 0 : 1;
    const currentRank = current.location === siteKey ? 0 : 1;
    return candidateRank !== currentRank ? candidateRank < currentRank : candidate.updatedAt.getTime() > current.updatedAt.getTime();
  };
  const rowMap = new Map<string, RankRow>();
  for (const row of rows) { const current = rowMap.get(row.csvDashboardRowId); if (!current || preferred(row, current)) rowMap.set(row.csvDashboardRowId, row); }
  const splitMap = new Map<string, SplitRankRow>();
  for (const row of splits) { const current = splitMap.get(row.splitId); if (!current || preferred(row, current)) splitMap.set(row.splitId, row); }
  return { rows: rowMap, splits: splitMap };
}

async function readOverrides(client: DbClient, siteKey: string, itemKeys?: readonly string[]): Promise<Map<string, ProductionScheduleGrindingPlanningBoardOverride>> {
  const rows = await client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey,
      ...(itemKeys == null ? {} : { itemKey: { in: [...new Set(itemKeys)] } })
    }
  });
  return new Map(rows.map((row) => [row.itemKey, row]));
}

async function readMasterResourceCds(client: DbClient): Promise<Set<string>> {
  const rows = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true } });
  return new Set(rows.map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean));
}

async function readPlanningResourceCandidates(client: DbClient, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): Promise<string[]> {
  const master = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true } });
  return Array.from(new Set(master.map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean))).filter((value) => isCategoryResource(value, category, policy)).sort((a, b) => a.localeCompare(b));
}

function stateOrder(state: { seibanOrder: Prisma.JsonValue }): string[] {
  return Array.isArray(state.seibanOrder) ? uniqueFseibans(state.seibanOrder.filter((value): value is string => typeof value === 'string')) : [];
}

function orderHash(order: readonly string[]): string { return createHash('sha256').update(JSON.stringify(order)).digest('hex'); }

function boardRevision(state: PlanningState): string { return JSON.stringify({ boardVersion: state.version, orderHash: orderHash(stateOrder(state)) }); }

function parseBoardRevision(value: string): { boardVersion: number | null; orderHash: string } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.orderHash !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.orderHash) ||
      typeof parsed.boardVersion !== 'number' || !Number.isSafeInteger(parsed.boardVersion) || parsed.boardVersion < 0
    ) throw new Error('invalid board revision');
    return { boardVersion: parsed.boardVersion, orderHash: parsed.orderHash };
  } catch {
    throw new ApiError(409, '表示時点のデータを再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
  }
}

function assertBoardRevision(expected: string, current: PlanningState): void {
  const parsed = parseBoardRevision(expected);
  if (parsed.orderHash !== orderHash(stateOrder(current)) || (parsed.boardVersion != null && parsed.boardVersion !== current.version)) throw new ApiError(409, '製番順が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ORDER');
}

async function getOrCreateState(siteKey: string, fseibans: readonly string[], client: DbClient = prisma): Promise<PlanningState> {
  const existing = await client.productionScheduleGrindingPlanningBoardState.findUnique({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  if (existing) return existing as PlanningState;
  let order: string[] = [];
  if (client === prisma) {
    const { getProductionScheduleSearchState } = await import('./production-schedule-search-state.service.js');
    const sharedHistory = await getProductionScheduleSearchState('shared');
    // The first board copy is intentionally independent from the current winner set.
    // Shared search history is the user's registered list; missing rows are resolved
    // on the next read without mutating the copied site order.
    const seeded = uniqueFseibans(sharedHistory.state.history);
    order = seeded;
  }
  try {
    return await client.productionScheduleGrindingPlanningBoardState.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, seibanOrder: order } }) as PlanningState;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await client.productionScheduleGrindingPlanningBoardState.findUnique({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
      if (raced) return raced as PlanningState;
    }
    throw error;
  }
}

type PlanningSnapshotPayload = {
  items: GrindingPlanningBoardItem[];
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
  seibanProgress: Record<string, { completed: number; total: number }>;
  resources: string[];
};

function isPlanningSnapshotPayload(value: unknown): value is PlanningSnapshotPayload {
  if (value == null || typeof value !== 'object') return false;
  const payload = value as Partial<PlanningSnapshotPayload>;
  return Array.isArray(payload.items) && Array.isArray(payload.load) &&
    typeof payload.unknownRequiredMinutesCount === 'number' &&
    payload.seibanProgress != null && typeof payload.seibanProgress === 'object' &&
    Array.isArray(payload.resources);
}

async function readPlanningSnapshotGenerationDetails(siteKey: string): Promise<PlanningSnapshotGenerationDetails> {
  const [leaderboardGeneration, state, overrides] = await Promise.all([
    readLeaderboardShellSnapshotGenerationToken(),
    prisma.productionScheduleGrindingPlanningBoardState.findUnique({
      where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } },
      select: { version: true, updatedAt: true }
    }),
    prisma.productionScheduleGrindingPlanningBoardOverride.aggregate({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey },
      _count: { _all: true },
      _max: { updatedAt: true }
    })
  ]);
  const boardVersion = state?.version ?? 0;
  const boardUpdatedAt = state?.updatedAt?.toISOString() ?? '';
  return {
    generationToken: JSON.stringify({
      leaderboardGeneration,
      boardVersion,
      boardUpdatedAt,
      overrideCount: overrides._count._all,
      overrideUpdatedAt: overrides._max.updatedAt?.toISOString() ?? ''
    }),
    leaderboardGenerationToken: leaderboardGeneration,
    boardVersion,
    boardUpdatedAt
  };
}

async function readPlanningSnapshotGenerationToken(siteKey: string): Promise<string> {
  return (await readPlanningSnapshotGenerationDetails(siteKey)).generationToken;
}

function isPlanningStateAlignedWithGeneration(
  state: PlanningState,
  generation: PlanningSnapshotGenerationDetails
): boolean {
  const stateUpdatedAt = state.updatedAt instanceof Date ? state.updatedAt.toISOString() : '';
  return state.version === generation.boardVersion && stateUpdatedAt === generation.boardUpdatedAt;
}

function progressMapToRecord(progress: ReadonlyMap<string, { completed: number; total: number }>): Record<string, { completed: number; total: number }> { return Object.fromEntries(progress.entries()); }

async function projectCurrentBoard(params: { client: DbClient; siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; state: PlanningState; selectedFseibans?: ReadonlySet<string>; machineNames?: ReadonlyMap<string, string | null>; source?: PlanningSource }): Promise<{ allItems: GrindingPlanningBoardItem[]; items: GrindingPlanningBoardItem[]; load: GrindingPlanningBoardLoad[]; unknownRequiredMinutesCount: number; progress: ReturnType<typeof projectGrindingPlanningBoard>['progress']; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>; sourceRows: WinnerRow[]; details: Map<string, RowDetail> }> {
  const source = params.source ?? await readPlanningSource({
    siteKey: params.siteKey,
    category: params.category,
    fseibans: stateOrder(params.state)
  });
  const [policy, overrides] = await Promise.all([getResourceCategoryPolicy({ siteKey: params.siteKey }), readOverrides(params.client, params.siteKey)]);
  const rows = source.rows;
  const details = source.details;
  const displayRowIds = rows.filter((row) => {
    if (!params.selectedFseibans) return true;
    return params.selectedFseibans.has(valueAsString(asRowData(row.rowData), 'FSEIBAN'));
  }).map((row) => row.id);
  const splitIds = displayRowIds.flatMap((rowId) => details.get(rowId)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, displayRowIds, splitIds, params.siteKey);
  const projection = projectGrindingPlanningBoard({ rows, details, ranks, overrides, progressRows: source.progressRows, splitEnabled: isProductionScheduleOrderSplitEnabled(), category: params.category, view: params.view, seibanOrder: stateOrder(params.state), selectedFseibans: params.selectedFseibans, machineNameBySeiban: params.machineNames, isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, policy) });
  return { allItems: projection.allItems, items: projection.items, load: projection.load, unknownRequiredMinutesCount: projection.unknownRequiredMinutesCount, progress: projection.progress, policy, overrides, sourceRows: rows, details };
}

export async function getGrindingPlanningBoard(params: { siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; fseibans?: string[]; cursor?: number; pageSize?: number; snapshotId?: string; completionFilter?: 'all' | 'complete' | 'incomplete'; snapshotStore?: LeaderboardShellSnapshotStore }): Promise<GrindingPlanningBoardResponse> {
  if ((params.cursor ?? 0) > 0 && !params.snapshotId) throw new ApiError(400, '続きの cursor には snapshotId が必要です', undefined, 'INVALID_PLANNING_BOARD_CURSOR');
  // Capture the state returned by the ensure/read and then compare it with the
  // state fields in the generation token. A final token after the source/load
  // work still rejects CSV, state, or override updates during the request.
  const stateForRead = await getOrCreateState(params.siteKey, [], prisma);
  const generationBeforeRead = await readPlanningSnapshotGenerationDetails(params.siteKey);
  if (!isPlanningStateAlignedWithGeneration(stateForRead, generationBeforeRead)) {
    throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
  }
  const order = stateOrder(stateForRead);
  const requested = params.fseibans && params.fseibans.length > 0 ? new Set(uniqueFseibans(params.fseibans)) : undefined;
  const selected = requested ? order.filter((value) => requested.has(value)) : order;
  const completionFilter = params.completionFilter ?? 'all';
  const filterFingerprint = JSON.stringify({ siteKey: params.siteKey, category: params.category, view: params.view, fseibans: selected, completionFilter });
  const store = params.snapshotStore ?? fallbackPlanningSnapshotStore;
  let snapshotId = params.snapshotId;
  let orderedIds: readonly string[];
  let payload: PlanningSnapshotPayload;
  if (snapshotId) {
    const snapshot = store.get(snapshotId);
    const sameScope = snapshot != null && snapshot.siteKey === params.siteKey && snapshot.locationKey === params.siteKey && snapshot.filterFingerprint === filterFingerprint;
    const generation = await readPlanningSnapshotGenerationToken(params.siteKey);
    if (!snapshot || !sameScope || snapshot.generationToken !== generationBeforeRead.generationToken || snapshot.generationToken !== generation || snapshot.partialOrdering || !isPlanningSnapshotPayload(snapshot.payload)) {
      // A binding mismatch may refer to another terminal/site/filter. Do not
      // let one caller delete a valid snapshot owned by that scope.
      if (sameScope) store.delete(snapshotId);
      throw new ApiError(409, '一覧が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
    }
    orderedIds = snapshot.orderedRowIds;
    payload = snapshot.payload;
  } else {
    const source = await readPlanningSource({
      siteKey: params.siteKey,
      category: params.category,
      fseibans: selected,
      leaderboardGenerationToken: generationBeforeRead.leaderboardGenerationToken
    });
    const names = await resolveSeibanMachineDisplayNamesBatched(order);
    const projection = await projectCurrentBoard({ client: prisma, siteKey: params.siteKey, category: params.category, view: params.view, state: stateForRead, selectedFseibans: new Set(selected), machineNames: new Map(Object.entries(names.machineNames)), source });
    const filtered = completionFilter === 'complete' ? projection.items.filter((item) => item.isCompleted) : completionFilter === 'incomplete' ? projection.items.filter((item) => !item.isCompleted) : projection.items;
    const loadSummary = await readGrindingPlanningBoardLoadSummary({
      client: prisma,
      leaderboardMaterializedBaseWhere: source.baseWhere,
      siteKey: params.siteKey,
      category: params.category,
      splitEnabled: isProductionScheduleOrderSplitEnabled(),
      isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, projection.policy)
    });
    const generation = await readPlanningSnapshotGenerationToken(params.siteKey);
    if (generation !== generationBeforeRead.generationToken) {
      throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
    }
    orderedIds = filtered.map((item) => item.itemId);
    payload = {
      items: filtered,
      load: loadSummary.load,
      unknownRequiredMinutesCount: loadSummary.unknownRequiredMinutesCount,
      seibanProgress: progressMapToRecord(projection.progress.bySeiban),
      resources: await readPlanningResourceCandidates(prisma, params.category, projection.policy)
    };
    snapshotId = store.create({ orderedRowIds: orderedIds, partialOrdering: false, filterFingerprint, generationToken: generation, locationKey: params.siteKey, siteKey: params.siteKey, payload });
  }
  const byId = new Map(payload.items.map((item) => [item.itemId, item]));
  const orderedItems = orderedIds.map((id) => byId.get(id)).filter((item): item is GrindingPlanningBoardItem => item != null);
  const cursor = Math.max(params.cursor ?? 0, 0);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = orderedItems.slice(cursor, cursor + pageSize);
  return {
    siteKey: params.siteKey,
    category: params.category,
    view: params.view,
    sourceRevision: boardRevision(stateForRead),
    boardVersion: stateForRead.version,
    registeredFseibans: order,
    seibanOrder: selected,
    resources: payload.resources,
    items: page,
    load: payload.load,
    unknownRequiredMinutesCount: payload.unknownRequiredMinutesCount,
    seibanProgress: payload.seibanProgress,
    snapshotId,
    nextCursor: cursor + page.length < orderedItems.length ? String(cursor + page.length) : null
  };
}

async function discoverSourceRows(itemIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await readWinnerRows(prisma);
  const byLogicalKey = new Map(rows.map((row) => [buildGrindingPlanningBoardLogicalKey(asRowData(row.rowData)), row.id]));
  const splitIds = itemIds.filter((itemId) => itemId.startsWith(SPLIT_PREFIX)).map((itemId) => itemId.slice(SPLIT_PREFIX.length));
  const splits = splitIds.length === 0 ? [] : await prisma.productionScheduleOrderSplit.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, id: { in: splitIds } }, select: { id: true, parentCsvDashboardRowId: true } });
  const sourceByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    if (itemId.startsWith(SPLIT_PREFIX)) {
      const split = splits.find((candidate) => `split:${candidate.id}` === itemId);
      if (split) sourceByItem.set(itemId, split.parentCsvDashboardRowId);
      continue;
    }
    const logicalKey = decodeRowItemId(itemId);
    if (logicalKey == null) throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
    const sourceRowId = byLogicalKey.get(logicalKey);
    if (sourceRowId) sourceByItem.set(itemId, sourceRowId);
  }
  if (sourceByItem.size !== new Set(itemIds).size) throw new ApiError(409, '対象アイテムが消滅または更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return sourceByItem;
}

async function ensurePlanningBoardState(siteKey: string): Promise<void> {
  await getOrCreateState(siteKey, [], prisma);
}

async function lockState(client: Prisma.TransactionClient, siteKey: string): Promise<PlanningState> {
  const rows = await client.$queryRaw<PlanningState[]>`
    SELECT "id", "version", "seibanOrder" FROM "ProductionScheduleGrindingPlanningBoardState"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey} FOR UPDATE
  `;
  if (!rows[0]) throw new ApiError(409, 'ボード状態が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
  return rows[0];
}

async function readState(client: Prisma.TransactionClient, siteKey: string): Promise<PlanningState> {
  const state = await client.productionScheduleGrindingPlanningBoardState.findUnique({
    where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } }
  });
  if (!state) throw new ApiError(409, 'ボード状態が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
  return state as PlanningState;
}

async function resolveCurrentProjectionInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRowIds: readonly string[]; itemIds: readonly string[]; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; includeAllOverrides?: boolean }): Promise<CurrentProjection> {
  const state = await readState(params.client, params.siteKey);
  const rows = await readWinnerRowsByIds(params.client, params.sourceRowIds);
  const details = await readRowDetails(params.client, rows.map((row) => row.id));
  const splitIds = rows.flatMap((row) => details.get(row.id)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, rows.map((row) => row.id), splitIds, params.siteKey);
  // Include parent overrides when a split item inherits its parent's due date.
  // The scope writer invalidates the inherited split rank while leaving the
  // split override absent, so projection must see both keys together.
  const parentItemIds = rows.map((row) => buildGrindingPlanningBoardRowItemId(asRowData(row.rowData)));
  const overrides = await readOverrides(
    params.client,
    params.siteKey,
    params.includeAllOverrides ? undefined : [...new Set([...params.itemIds, ...parentItemIds])]
  );
  const masterResourceCds = await readMasterResourceCds(params.client);
  const progressRows: GrindingPlanningBoardProgressRow[] = rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const data = asRowData(row.rowData);
    const fhincd = valueAsString(data, 'FHINCD').trim().toUpperCase();
    const resourceCd = normalizeProductionScheduleResourceCd(valueAsString(data, 'FSIGENCD'));
    if (fhincd.startsWith('MH') || fhincd.startsWith('SH') || (resourceCd != null && params.policy.cuttingExcludedResourceCds.includes(resourceCd))) return [];
    return [{ rowId: row.id, fseiban: valueAsString(data, 'FSEIBAN'), productNo: valueAsString(data, 'ProductNo'), fhincd: valueAsString(data, 'FHINCD'), isCompleted: Boolean(detail.productionScheduleProgress?.isCompleted || detail.productionScheduleExternalCompletion?.isExternallyCompleted) }];
  });
  const splitEnabled = isProductionScheduleOrderSplitEnabled();
  const common = { rows, details, ranks, overrides, progressRows, splitEnabled, seibanOrder: stateOrder(state), isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, params.policy) };
  const grinding = projectGrindingPlanningBoard({ ...common, category: 'grinding' });
  const cutting = projectGrindingPlanningBoard({ ...common, category: 'cutting' });
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const item of [...grinding.allItems, ...cutting.allItems]) byItemId.set(item.itemId, item);
  const parentEffectiveDueBySourceRow = new Map<string, string | null>();
  const splitOriginalDueByItemId = new Map<string, string | null>();
  for (const row of rows) {
    const detail = details.get(row.id);
    if (!detail) continue;
    const parentItemId = buildGrindingPlanningBoardRowItemId(asRowData(row.rowData));
    parentEffectiveDueBySourceRow.set(row.id, resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate: detail.rowNotes[0]?.dueDate ?? detail.orderSupplements[0]?.plannedEndDate ?? null,
      plannedEndDate: detail.orderSupplements[0]?.plannedEndDate ?? null,
      override: overrides.get(parentItemId)
    }));
    for (const split of detail.orderSplits) splitOriginalDueByItemId.set(`${SPLIT_PREFIX}${split.id}`, ymd(split.dueDate));
  }
  for (const itemId of params.itemIds) {
    const item = byItemId.get(itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅または工程区分が変わりました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (!params.sourceRowIds.includes(item.sourceRowId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  }
  return { state, byItemId, overrides, rows, details, ranks, progressRows, splitEnabled, policy: params.policy, sourceRowIds: new Map(), masterResourceCds, parentEffectiveDueBySourceRow, splitOriginalDueByItemId };
}

function assertItemRevision(expected: string, item: GrindingPlanningBoardItem, expectedVersion?: number): void {
  if (expected !== item.itemRevision || (expectedVersion != null && expectedVersion !== item.version)) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean { return ymd(a) === ymd(b); }

function sameTimestamp(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

type PersistedSpecialDue = {
  specialDueKind: string | null;
  specialDueExpiresAt: Date | null;
};

async function writeOverrideIfChanged(client: Prisma.TransactionClient, siteKey: string, itemId: string, current: ProductionScheduleGrindingPlanningBoardOverride | undefined, next: { overrideResourceCd: string | null; overrideDueDate: Date | null; dueDateCleared: boolean | null; alternateRank: number | null } & PersistedSpecialDue): Promise<ProductionScheduleGrindingPlanningBoardOverride | undefined> {
  const changed = current == null
    ? next.overrideResourceCd != null || next.overrideDueDate != null || next.dueDateCleared != null || next.alternateRank != null || next.specialDueKind != null || next.specialDueExpiresAt != null
    : current.overrideResourceCd !== next.overrideResourceCd || !sameDate(current.overrideDueDate, next.overrideDueDate) || (current.dueDateCleared ?? null) !== next.dueDateCleared || current.alternateRank !== next.alternateRank || (current.specialDueKind ?? null) !== next.specialDueKind || !sameTimestamp(current.specialDueExpiresAt, next.specialDueExpiresAt);
  if (!changed) return current;
  return client.productionScheduleGrindingPlanningBoardOverride.upsert({
    where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId } },
    create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId, overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, dueDateCleared: next.dueDateCleared, alternateRank: next.alternateRank, specialDueKind: next.specialDueKind, specialDueExpiresAt: next.specialDueExpiresAt },
    update: { overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, dueDateCleared: next.dueDateCleared, alternateRank: next.alternateRank, specialDueKind: next.specialDueKind, specialDueExpiresAt: next.specialDueExpiresAt, version: { increment: 1 } }
  });
}

type OverrideRequest = { itemId: string; itemRevision: string; overrideVersion?: number; resourceCd?: string | null; due?: GrindingPlanningBoardDueRequest; specialDue?: GrindingPlanningBoardSpecialDueKind | null; alternateRank?: number | null };

async function readSpecialDueCalendarModes(siteKey: string, requests: readonly OverrideRequest[]): Promise<ReadonlyMap<string, WorkCalendarMode>> {
  if (!requests.some((request) => request.specialDue === 'overnight')) return new Map();
  const settings = await listLoadBalancingWorkCalendarsResolved(siteKey);
  return buildWorkCalendarModeMap(settings.items);
}

type AppliedOverrides = {
  state: PlanningState;
  current: CurrentProjection;
  overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>;
};

async function applyOverridesInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRevision: string; requests: readonly OverrideRequest[]; sourceRowIds: ReadonlyMap<string, string>; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; workCalendarModeByResource: ReadonlyMap<string, WorkCalendarMode> }): Promise<AppliedOverrides> {
  const rowsToLock = Array.from(new Set(params.sourceRowIds.values())).sort();
  for (const sourceRowId of rowsToLock) {
    await acquireProductionScheduleParentRowLockInTransaction(params.client, sourceRowId);
    const locked = await params.client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${sourceRowId} AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} FOR UPDATE`;
    if (!locked[0]) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  }
  const current = await resolveCurrentProjectionInTransaction({ client: params.client, siteKey: params.siteKey, sourceRowIds: rowsToLock, itemIds: params.requests.map((request) => request.itemId), policy: params.policy });
  // Item mutations are guarded by the target itemRevision/overrideVersion only.
  // The board order version belongs to seiban-order mutations and must not make an
  // unrelated item edit fail after another terminal reorders the left pane.
  const desired: Array<{ request: OverrideRequest; currentOverride: ProductionScheduleGrindingPlanningBoardOverride | undefined; next: { overrideResourceCd: string | null; overrideDueDate: Date | null; dueDateCleared: boolean | null; alternateRank: number | null } & PersistedSpecialDue }> = [];
  for (const request of params.requests) {
    const item = current.byItemId.get(request.itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (item.isCompleted) throw new ApiError(409, '完了済みの工程は変更できません', undefined, 'COMPLETED_ITEM');
    if (item.sourceRowId !== params.sourceRowIds.get(request.itemId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    assertItemRevision(request.itemRevision, item, request.overrideVersion);
    const currentOverride = current.overrides.get(request.itemId);
    let nextOverrideResource = currentOverride?.overrideResourceCd ?? null;
    let nextOverrideDue = currentOverride?.overrideDueDate ?? null;
    let nextDueDateCleared = currentOverride?.dueDateCleared ?? null;
    let nextSpecialDueKind = currentOverride?.specialDueKind ?? null;
    let nextSpecialDueExpiresAt = currentOverride?.specialDueExpiresAt ?? null;
    if (request.resourceCd !== undefined) {
      if (request.resourceCd == null) nextOverrideResource = null;
      else {
        const candidate = normalizeProductionScheduleResourceCd(request.resourceCd);
        const sourceCategory: GrindingPlanningBoardCategory = isProductionScheduleGrindingResourceCd(item.originalResourceCd ?? '', params.policy) ? 'grinding' : 'cutting';
        if (!current.masterResourceCds.has(candidate)) throw new ApiError(400, '資源マスタに存在しない資源CDです', undefined, 'UNKNOWN_RESOURCE');
        if (!isCategoryResource(candidate, sourceCategory, params.policy)) throw new ApiError(400, '同じ工程区分の資源CDを指定してください', undefined, 'RESOURCE_CATEGORY_MISMATCH');
        // Applying the original resource to an already-original item is a true
        // no-op. Preserve an existing override when it already represents the
        // effective value; explicit null remains the restore operation.
        if (candidate === item.effectiveResourceCd) {
          nextOverrideResource = currentOverride?.overrideResourceCd ?? null;
        } else {
          nextOverrideResource = candidate === item.originalResourceCd ? null : candidate;
        }
      }
    }
    if (request.due !== undefined) {
      const due = resolvePlanningBoardDueRequest({ request: request.due, currentEffectiveDueDate: item.effectiveDueDate, originalDueDate: item.originalDueDate });
      if (due !== undefined) {
        nextOverrideDue = due;
        nextDueDateCleared = false;
      }
    }
    if (request.specialDue !== undefined) {
      if (request.specialDue == null) {
        nextSpecialDueKind = null;
        nextSpecialDueExpiresAt = null;
      } else {
        if (!isGrindingPlanningBoardSpecialDueKind(request.specialDue)) throw new ApiError(400, '特別納期種別が不正です', undefined, 'INVALID_SPECIAL_DUE');
        const effectiveResourceCd = nextOverrideResource ?? item.originalResourceCd;
        nextSpecialDueKind = request.specialDue;
        nextSpecialDueExpiresAt = resolveGrindingPlanningBoardSpecialDueExpiresAt({
          kind: request.specialDue,
          workCalendarMode: params.workCalendarModeByResource.get(
            effectiveResourceCd == null ? '' : normalizeProductionScheduleResourceCd(effectiveResourceCd)
          ) ?? DEFAULT_WORK_CALENDAR_MODE
        });
      }
    }
    const resourceChanged = request.resourceCd !== undefined && (nextOverrideResource ?? item.originalResourceCd) !== item.effectiveResourceCd;
    const effectiveDueAfterOverride = nextOverrideDue != null
      ? ymd(nextOverrideDue)
      : item.kind === 'split'
        ? current.splitOriginalDueByItemId.get(item.itemId)
          ?? (current.parentEffectiveDueBySourceRow.has(item.sourceRowId)
            ? current.parentEffectiveDueBySourceRow.get(item.sourceRowId) ?? null
            : item.originalDueDate)
        : item.originalDueDate;
    const dueChanged = request.due !== undefined && effectiveDueAfterOverride !== item.effectiveDueDate;
    desired.push({ request, currentOverride, next: { overrideResourceCd: nextOverrideResource, overrideDueDate: nextOverrideDue, dueDateCleared: nextDueDateCleared, alternateRank: request.alternateRank !== undefined ? request.alternateRank : resourceChanged || dueChanged ? null : currentOverride?.alternateRank ?? null, specialDueKind: nextSpecialDueKind, specialDueExpiresAt: nextSpecialDueExpiresAt } });
  }
  const overrides = new Map(current.overrides);
  for (const update of desired) {
    const saved = await writeOverrideIfChanged(params.client, params.siteKey, update.request.itemId, update.currentOverride, update.next);
    if (saved) overrides.set(update.request.itemId, saved);
  }
  return { state: current.state, current, overrides };
}

function projectCurrentItems(current: CurrentProjection, overrides: ReadonlyMap<string, ProductionScheduleGrindingPlanningBoardOverride>): Map<string, GrindingPlanningBoardItem> {
  const common = {
    rows: current.rows,
    details: current.details,
    ranks: current.ranks,
    overrides,
    progressRows: current.progressRows,
    splitEnabled: current.splitEnabled,
    seibanOrder: stateOrder(current.state),
    isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, current.policy)
  };
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const category of ['grinding', 'cutting'] as const) {
    for (const item of projectGrindingPlanningBoard({ ...common, category }).allItems) byItemId.set(item.itemId, item);
  }
  return byItemId;
}

function projectCurrentItem(current: CurrentProjection, overrides: ReadonlyMap<string, ProductionScheduleGrindingPlanningBoardOverride>, itemId: string): GrindingPlanningBoardItem {
  const common = {
    rows: current.rows,
    details: current.details,
    ranks: current.ranks,
    overrides,
    progressRows: current.progressRows,
    splitEnabled: current.splitEnabled,
    seibanOrder: stateOrder(current.state),
    isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, current.policy)
  };
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const category of ['grinding', 'cutting'] as const) {
    for (const item of projectGrindingPlanningBoard({ ...common, category }).allItems) byItemId.set(item.itemId, item);
  }
  const item = byItemId.get(itemId);
  if (!item) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return item;
}

export async function updateGrindingPlanningBoardOverrides(params: { siteKey: string; sourceRevision: string; items: OverrideRequest[] }): Promise<GrindingPlanningBoardOverridesResponse> {
  const itemIds = params.items.map((item) => item.itemId);
  if (new Set(itemIds).size !== itemIds.length) throw new ApiError(400, '対象アイテムが重複しています', undefined, 'DUPLICATE_ITEM');
  const sourceRowIds = await discoverSourceRows(itemIds);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const workCalendarModeByResource = await readSpecialDueCalendarModes(params.siteKey, params.items);
  try {
    // Parent-row advisory/row locks and target item revisions provide the
    // write-conflict guarantee here. RepeatableRead avoids a PostgreSQL SSI
    // predicate lock on the small override table turning independent items
    // into a false serialization conflict.
    const result = await prisma.$transaction(async (client) => {
      const applied = await applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: params.items, sourceRowIds, policy, workCalendarModeByResource });
      const projectedItems = projectCurrentItems(applied.current, applied.overrides);
      const items = params.items.map((request) => {
        const item = projectedItems.get(request.itemId);
        if (!item) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
        return item;
      });
      return { ...applied, items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      sourceRevision: boardRevision(result.state),
      items: result.items
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardRank(params: { siteKey: string; sourceRevision: string; itemId: string; itemRevision: string; overrideVersion?: number; alternateRank: number | null }): Promise<GrindingPlanningBoardRankResponse> {
  if (params.alternateRank != null && (!Number.isSafeInteger(params.alternateRank) || params.alternateRank < 1 || params.alternateRank > MAX_ALTERNATE_RANK)) throw new ApiError(400, '個別順位は1以上2147483647以下で指定してください', undefined, 'INVALID_ALTERNATE_RANK');
  const sourceRowIds = await discoverSourceRows([params.itemId]);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const workCalendarModeByResource = new Map<string, WorkCalendarMode>();
  try {
    const result = await prisma.$transaction((client) => applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: [{ itemId: params.itemId, itemRevision: params.itemRevision, overrideVersion: params.overrideVersion, alternateRank: params.alternateRank }], sourceRowIds, policy, workCalendarModeByResource }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const item = projectCurrentItem(result.current, result.overrides, params.itemId);
    return {
      sourceRevision: boardRevision(result.state),
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      alternateRank: item.alternateRank
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardResourceOrder(params: {
  siteKey: string;
} & GrindingPlanningBoardResourceOrderRequest): Promise<GrindingPlanningBoardResourceOrderResponse> {
  if (params.itemId === params.targetItemId) {
    throw new ApiError(400, '同じアイテムの前後には移動できません', undefined, 'INVALID_RESOURCE_ORDER_TARGET');
  }
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  try {
    const result = await prisma.$transaction(async (client) => {
      const lockedState = await lockState(client, params.siteKey);
      assertBoardRevision(params.sourceRevision, lockedState);
      const registeredFseibans = new Set(stateOrder(lockedState));
      const winnerRows = await readWinnerRowsByFseibans(client, [...registeredFseibans]);
      const registeredRows = winnerRows.filter((row) => registeredFseibans.has(valueAsString(asRowData(row.rowData), 'FSEIBAN')));
      const registeredRowIds = [...new Set(registeredRows.map((row) => row.id))].sort();
      const beforeLock = await resolveCurrentProjectionInTransaction({
        client,
        siteKey: params.siteKey,
        sourceRowIds: registeredRowIds,
        itemIds: [params.itemId, params.targetItemId],
        policy,
        includeAllOverrides: true
      });
      const sourceBeforeLock = beforeLock.byItemId.get(params.itemId);
      const targetBeforeLock = beforeLock.byItemId.get(params.targetItemId);
      if (!sourceBeforeLock || !targetBeforeLock) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      const sourceCategoryBeforeLock: GrindingPlanningBoardCategory = isCategoryResource(sourceBeforeLock.originalResourceCd, 'grinding', policy)
        ? 'grinding'
        : 'cutting';
      const sourceResourceBeforeLock = sourceBeforeLock.effectiveResourceCd ?? sourceBeforeLock.originalResourceCd;
      const targetResourceBeforeLock = targetBeforeLock.effectiveResourceCd ?? targetBeforeLock.originalResourceCd;
      const paneRowIds = [...new Set([...beforeLock.byItemId.values()]
        .filter((item) =>
          isCategoryResource(item.originalResourceCd, sourceCategoryBeforeLock, policy) &&
          sourceResourceBeforeLock != null &&
          (item.effectiveResourceCd ?? item.originalResourceCd) === sourceResourceBeforeLock
        )
        .map((item) => item.sourceRowId))].sort();
      if (targetResourceBeforeLock !== sourceResourceBeforeLock || paneRowIds.length === 0) {
        throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
      }
      for (const sourceRowId of paneRowIds) {
        await acquireProductionScheduleParentRowLockInTransaction(client, sourceRowId);
        const locked = await client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${sourceRowId} AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} FOR UPDATE`;
        if (!locked[0]) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      }
      const current = await resolveCurrentProjectionInTransaction({
        client,
        siteKey: params.siteKey,
        sourceRowIds: paneRowIds,
        itemIds: [params.itemId, params.targetItemId],
        policy,
        includeAllOverrides: true
      });
      const source = current.byItemId.get(params.itemId);
      const target = current.byItemId.get(params.targetItemId);
      if (!source || !target) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      assertItemRevision(params.itemRevision, source, params.overrideVersion);
      assertItemRevision(params.targetItemRevision, target, params.targetOverrideVersion);
      if (source.isCompleted || target.isCompleted) throw new ApiError(409, '完了済みの工程は並べ替えできません', undefined, 'COMPLETED_ITEM');
      const sourceCategory: GrindingPlanningBoardCategory = isCategoryResource(source.originalResourceCd, 'grinding', policy)
        ? 'grinding'
        : 'cutting';
      if (!isCategoryResource(source.originalResourceCd, sourceCategory, policy) || !isCategoryResource(target.originalResourceCd, sourceCategory, policy)) {
        throw new ApiError(409, '工程区分が異なるため並べ替えできません', undefined, 'RESOURCE_CATEGORY_MISMATCH');
      }
      const sourceResource = source.effectiveResourceCd ?? source.originalResourceCd;
      const targetResource = target.effectiveResourceCd ?? target.originalResourceCd;
      if (!sourceResource || sourceResource !== targetResource) {
        throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
      }
      const sourceSpecialDueBand = source.specialDue?.expiresAt ?? null;
      const targetSpecialDueBand = target.specialDue?.expiresAt ?? null;
      if (sourceSpecialDueBand !== targetSpecialDueBand) {
        throw new ApiError(409, '特別納期の優先帯をまたいで並べ替えできません', undefined, 'SPECIAL_DUE_ORDER_BAND_MISMATCH');
      }
      const pane = [...current.byItemId.values()].filter((item) =>
        isCategoryResource(item.originalResourceCd, sourceCategory, policy) &&
        (item.effectiveResourceCd ?? item.originalResourceCd) === sourceResource
      );
      const ordered = sortGrindingPlanningBoardProjectionItems(
        pane,
        stateOrder(current.state),
        'resource',
        'alternate'
      );
      const originalOrder = ordered.map((item) => item.itemId);
      const sourceIndex = ordered.findIndex((item) => item.itemId === source.itemId);
      const targetIndex = ordered.findIndex((item) => item.itemId === target.itemId);
      if (sourceIndex < 0 || targetIndex < 0) throw new ApiError(409, '対象アイテムが表示中の資源CDにありません', undefined, 'STALE_PLANNING_BOARD_ITEM');
      const [moved] = ordered.splice(sourceIndex, 1);
      const insertionIndex = ordered.findIndex((item) => item.itemId === target.itemId) + (params.placement === 'after' ? 1 : 0);
      ordered.splice(insertionIndex, 0, moved);

      const orderChanged = ordered.some((item, index) => item.itemId !== originalOrder[index]);
      if (!orderChanged) {
        return { state: lockedState, items: ordered };
      }

      const overrides = new Map(current.overrides);
      const bandItems = ordered.filter((item) => (item.specialDue?.expiresAt ?? null) === sourceSpecialDueBand);
      for (const [index, item] of bandItems.entries()) {
        if (index + 1 > MAX_ALTERNATE_RANK) throw new ApiError(400, '資源CD内のアイテム数が上限を超えています', undefined, 'RESOURCE_ORDER_LIMIT_EXCEEDED');
        const currentOverride = current.overrides.get(item.itemId);
        const saved = await writeOverrideIfChanged(client, params.siteKey, item.itemId, currentOverride, {
          overrideResourceCd: currentOverride?.overrideResourceCd ?? null,
          overrideDueDate: currentOverride?.overrideDueDate ?? null,
          dueDateCleared: currentOverride?.dueDateCleared ?? null,
          alternateRank: index + 1,
          specialDueKind: currentOverride?.specialDueKind ?? null,
          specialDueExpiresAt: currentOverride?.specialDueExpiresAt ?? null
        });
        if (saved) overrides.set(item.itemId, saved);
      }
      const projectedItems = projectCurrentItems(current, overrides);
      const items = ordered.map((item) => {
        const projected = projectedItems.get(item.itemId);
        if (!projected) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
        return projected;
      });
      return { state: lockedState, items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { sourceRevision: boardRevision(result.state), items: result.items };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardSeibanOrder(params: { siteKey: string; sourceRevision: string; fseibans: string[] }): Promise<{ sourceRevision: string; seibanOrder: string[] }> {
  const normalizedOrder = normalizeUniqueFseibans(params.fseibans);
  if (normalizedOrder.length > KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX) {
    throw new ApiError(400, `登録できる製番は${KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX}件までです`, undefined, 'SEIBAN_LIMIT_EXCEEDED');
  }
  const nextOrder = normalizedOrder;
  const rows = await readWinnerRowsByFseibans(prisma, nextOrder);
  const known = new Set(rows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')).filter(Boolean));
  const existingState = await getOrCreateState(params.siteKey, Array.from(known), prisma);
  const existingOrder = new Set(stateOrder(existingState));
  if (nextOrder.some((value) => !known.has(value) && !existingOrder.has(value))) throw new ApiError(400, '存在しない製番は登録できません', undefined, 'UNKNOWN_SEIBAN');
  try {
    const state = await prisma.$transaction(async (client) => {
      const current = await lockState(client, params.siteKey);
      assertBoardRevision(params.sourceRevision, current);
      if (JSON.stringify(stateOrder(current)) === JSON.stringify(nextOrder)) return current;
      return await client.productionScheduleGrindingPlanningBoardState.update({ where: { id: current.id }, data: { seibanOrder: nextOrder, version: { increment: 1 } } }) as PlanningState;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { sourceRevision: boardRevision(state), seibanOrder: stateOrder(state) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ORDER');
    throw error;
  }
}
