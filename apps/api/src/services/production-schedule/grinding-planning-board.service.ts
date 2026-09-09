import { createHash } from 'node:crypto';

import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardDueRequest,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardLoad,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardView
} from '@raspi-system/shared-types';

import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard/leaderboard-shell-snapshot.store.js';
import { createInMemoryLeaderboardShellSnapshotStore } from './leaderboard/leaderboard-shell-snapshot.store.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleCuttingResourceCd,
  isProductionScheduleGrindingResourceCd,
  normalizeProductionScheduleResourceCd
} from './policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';
import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from './row-resolver/constants.js';
import { isProductionScheduleOrderSplitEnabled } from './order-split/production-schedule-order-split-feature.js';
import { acquireProductionScheduleParentRowLockInTransaction } from './order-split/production-schedule-parent-row-lock.service.js';
import {
  projectGrindingPlanningBoard,
  buildGrindingPlanningBoardLogicalKey as buildProjectionLogicalKey,
  buildGrindingPlanningBoardRowItemId,
  type GrindingPlanningBoardProjectionRanks,
  type GrindingPlanningBoardProgressRow,
  type GrindingPlanningBoardProjectionRow,
  type GrindingPlanningBoardProjectionRowDetail
} from './grinding-planning-board-projection.js';
import { resolveSeibanMachineDisplayNamesBatched } from './seiban-machine-display-names.service.js';

const DEFAULT_PAGE_SIZE = 160;
const MAX_PAGE_SIZE = 160;
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
  seibanOrder: Prisma.JsonValue;
};
type CurrentProjection = {
  state: PlanningState;
  byItemId: Map<string, GrindingPlanningBoardItem>;
  overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>;
  sourceRowIds: Map<string, string>;
  masterResourceCds: Set<string>;
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

function uniqueFseibans(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX);
}

function isCategoryResource(resourceCd: string | null, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): boolean {
  if (!resourceCd) return false;
  return category === 'grinding' ? isProductionScheduleGrindingResourceCd(resourceCd, policy) : isProductionScheduleCuttingResourceCd(resourceCd, policy);
}

async function readWinnerRows(client: DbClient = prisma): Promise<WinnerRow[]> {
  return client.$queryRaw<WinnerRow[]>`
    SELECT "r"."id", "r"."rowData", "r"."updatedAt"
    FROM "CsvDashboardRow" AS "r"
    WHERE "r"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('r')}
  `;
}

async function readWinnerRowsByIds(client: DbClient, rowIds: readonly string[]): Promise<WinnerRow[]> {
  if (rowIds.length === 0) return [];
  return client.$queryRaw<WinnerRow[]>`
    SELECT "r"."id", "r"."rowData", "r"."updatedAt"
    FROM "CsvDashboardRow" AS "r"
    WHERE "r"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "r"."id" IN (${Prisma.join([...new Set(rowIds)].map((id) => Prisma.sql`${id}`), ',')})
      AND ${buildMaxProductNoWinnerCondition('r')}
  `;
}

async function readRowDetails(client: DbClient, rowIds: readonly string[]): Promise<Map<string, RowDetail>> {
  if (rowIds.length === 0) return new Map();
  const details = await client.csvDashboardRow.findMany({
    where: { id: { in: [...new Set(rowIds)] }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
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
  return new Map(details.map((detail) => [detail.id, detail as RowDetail]));
}

async function readRanks(client: DbClient, rowIds: readonly string[], splitIds: readonly string[], siteKey: string): Promise<GrindingPlanningBoardProjectionRanks> {
  const rows: RankRow[] = rowIds.length === 0 ? [] : await client.productionScheduleOrderAssignment.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: [...new Set(rowIds)] }, OR: [{ siteKey }, { location: siteKey }] },
    select: { csvDashboardRowId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
  });
  const splits: SplitRankRow[] = splitIds.length === 0 ? [] : await client.productionScheduleOrderSplitAssignment.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, splitId: { in: [...new Set(splitIds)] }, OR: [{ siteKey }, { location: siteKey }] },
    select: { splitId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
  });
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

function generationForItems(items: readonly GrindingPlanningBoardItem[], state: PlanningState): string {
  return createHash('sha256').update(JSON.stringify({ boardVersion: state.version, order: stateOrder(state), items: items.map((item) => [item.itemId, item.itemRevision]) })).digest('hex');
}

function progressMapToRecord(progress: ReadonlyMap<string, { completed: number; total: number }>): Record<string, { completed: number; total: number }> { return Object.fromEntries(progress.entries()); }

async function projectCurrentBoard(params: { client: DbClient; siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; state: PlanningState; selectedFseibans?: ReadonlySet<string>; machineNames?: ReadonlyMap<string, string | null> }): Promise<{ allItems: GrindingPlanningBoardItem[]; items: GrindingPlanningBoardItem[]; load: GrindingPlanningBoardLoad[]; unknownRequiredMinutesCount: number; progress: ReturnType<typeof projectGrindingPlanningBoard>['progress']; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>; sourceRows: WinnerRow[]; details: Map<string, RowDetail> }> {
  const [rows, policy, overrides] = await Promise.all([readWinnerRows(params.client), getResourceCategoryPolicy({ siteKey: params.siteKey }), readOverrides(params.client, params.siteKey)]);
  const details = await readRowDetails(params.client, rows.map((row) => row.id));
  const splitIds = rows.flatMap((row) => details.get(row.id)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, rows.map((row) => row.id), splitIds, params.siteKey);
  const progressRows: GrindingPlanningBoardProgressRow[] = rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const data = asRowData(row.rowData);
    const fhincd = valueAsString(data, 'FHINCD').trim().toUpperCase();
    const resourceCd = normalizeProductionScheduleResourceCd(valueAsString(data, 'FSIGENCD'));
    // Progress headers follow the existing due-management part population:
    // machine rows and excluded cutting resources are not parts.
    if (fhincd.startsWith('MH') || fhincd.startsWith('SH') || (resourceCd != null && policy.cuttingExcludedResourceCds.includes(resourceCd))) return [];
    return [{ rowId: row.id, fseiban: valueAsString(data, 'FSEIBAN'), productNo: valueAsString(data, 'ProductNo'), fhincd: valueAsString(data, 'FHINCD'), isCompleted: Boolean(detail.productionScheduleProgress?.isCompleted || detail.productionScheduleExternalCompletion?.isExternallyCompleted) }];
  });
  const projection = projectGrindingPlanningBoard({ rows, details, ranks, overrides, progressRows, splitEnabled: isProductionScheduleOrderSplitEnabled(), category: params.category, view: params.view, seibanOrder: stateOrder(params.state), selectedFseibans: params.selectedFseibans, machineNameBySeiban: params.machineNames, isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, policy) });
  return { allItems: projection.allItems, items: projection.items, load: projection.load, unknownRequiredMinutesCount: projection.unknownRequiredMinutesCount, progress: projection.progress, policy, overrides, sourceRows: rows, details };
}

export async function getGrindingPlanningBoard(params: { siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; fseibans?: string[]; cursor?: number; pageSize?: number; snapshotId?: string; completionFilter?: 'all' | 'complete' | 'incomplete'; snapshotStore?: LeaderboardShellSnapshotStore }): Promise<GrindingPlanningBoardResponse> {
  if ((params.cursor ?? 0) > 0 && !params.snapshotId) throw new ApiError(400, '続きの cursor には snapshotId が必要です', undefined, 'INVALID_PLANNING_BOARD_CURSOR');
  const initialRows = await readWinnerRows();
  const state = await getOrCreateState(params.siteKey, initialRows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')), prisma);
  const order = stateOrder(state);
  const requested = params.fseibans && params.fseibans.length > 0 ? new Set(uniqueFseibans(params.fseibans)) : undefined;
  const selected = requested ? order.filter((value) => requested.has(value)) : order;
  const names = await resolveSeibanMachineDisplayNamesBatched(order);
  const projection = await projectCurrentBoard({ client: prisma, siteKey: params.siteKey, category: params.category, view: params.view, state, selectedFseibans: requested ? new Set(selected) : undefined, machineNames: new Map(Object.entries(names.machineNames)) });
  const completionFilter = params.completionFilter ?? 'all';
  const filtered = completionFilter === 'complete' ? projection.items.filter((item) => item.isCompleted) : completionFilter === 'incomplete' ? projection.items.filter((item) => !item.isCompleted) : projection.items;
  const filterFingerprint = JSON.stringify({ siteKey: params.siteKey, category: params.category, view: params.view, fseibans: selected, completionFilter });
  const generation = generationForItems(projection.allItems, state);
  const store = params.snapshotStore ?? fallbackPlanningSnapshotStore;
  let snapshotId = params.snapshotId;
  let orderedIds: readonly string[];
  if (snapshotId) {
    const snapshot = store.get(snapshotId);
    const sameScope = snapshot != null && snapshot.siteKey === params.siteKey && snapshot.locationKey === params.siteKey && snapshot.filterFingerprint === filterFingerprint;
    if (!snapshot || !sameScope || snapshot.generationToken !== generation || snapshot.partialOrdering) {
      // A binding mismatch may refer to another terminal/site/filter. Do not
      // let one caller delete a valid snapshot owned by that scope.
      if (sameScope) store.delete(snapshotId);
      throw new ApiError(409, '一覧が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
    }
    orderedIds = snapshot.orderedRowIds;
  } else {
    orderedIds = filtered.map((item) => item.itemId);
    snapshotId = store.create({ orderedRowIds: orderedIds, partialOrdering: false, filterFingerprint, generationToken: generation, locationKey: params.siteKey, siteKey: params.siteKey });
  }
  const byId = new Map(filtered.map((item) => [item.itemId, item]));
  const orderedItems = orderedIds.map((id) => byId.get(id)).filter((item): item is GrindingPlanningBoardItem => item != null);
  const cursor = Math.max(params.cursor ?? 0, 0);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = orderedItems.slice(cursor, cursor + pageSize);
  return {
    siteKey: params.siteKey,
    category: params.category,
    view: params.view,
    sourceRevision: boardRevision(state),
    boardVersion: state.version,
    registeredFseibans: order,
    seibanOrder: selected,
    resources: await readPlanningResourceCandidates(prisma, params.category, projection.policy),
    items: page,
    load: projection.load,
    unknownRequiredMinutesCount: projection.unknownRequiredMinutesCount,
    seibanProgress: progressMapToRecord(projection.progress.bySeiban),
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
  const rows = await readWinnerRows(prisma);
  await getOrCreateState(siteKey, rows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')), prisma);
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

async function resolveCurrentProjectionInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRowIds: readonly string[]; itemIds: readonly string[]; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>> }): Promise<CurrentProjection> {
  const state = await readState(params.client, params.siteKey);
  const rows = await readWinnerRowsByIds(params.client, params.sourceRowIds);
  const details = await readRowDetails(params.client, rows.map((row) => row.id));
  const splitIds = rows.flatMap((row) => details.get(row.id)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, rows.map((row) => row.id), splitIds, params.siteKey);
  const overrides = await readOverrides(params.client, params.siteKey, params.itemIds);
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
  const common = { rows, details, ranks, overrides, progressRows, splitEnabled: isProductionScheduleOrderSplitEnabled(), seibanOrder: stateOrder(state), isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, params.policy) };
  const grinding = projectGrindingPlanningBoard({ ...common, category: 'grinding' });
  const cutting = projectGrindingPlanningBoard({ ...common, category: 'cutting' });
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const item of [...grinding.allItems, ...cutting.allItems]) byItemId.set(item.itemId, item);
  for (const itemId of params.itemIds) {
    const item = byItemId.get(itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅または工程区分が変わりました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (!params.sourceRowIds.includes(item.sourceRowId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  }
  return { state, byItemId, overrides, sourceRowIds: new Map(), masterResourceCds };
}

function assertItemRevision(expected: string, item: GrindingPlanningBoardItem, expectedVersion?: number): void {
  if (expected !== item.itemRevision || (expectedVersion != null && expectedVersion !== item.version)) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean { return ymd(a) === ymd(b); }

async function writeOverrideIfChanged(client: Prisma.TransactionClient, siteKey: string, itemId: string, current: ProductionScheduleGrindingPlanningBoardOverride | undefined, next: { overrideResourceCd: string | null; overrideDueDate: Date | null; alternateRank: number | null }): Promise<void> {
  const changed = current == null ? next.overrideResourceCd != null || next.overrideDueDate != null || next.alternateRank != null : current.overrideResourceCd !== next.overrideResourceCd || !sameDate(current.overrideDueDate, next.overrideDueDate) || current.alternateRank !== next.alternateRank;
  if (!changed) return;
  await client.productionScheduleGrindingPlanningBoardOverride.upsert({
    where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId } },
    create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId, overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, alternateRank: next.alternateRank },
    update: { overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, alternateRank: next.alternateRank, version: { increment: 1 } }
  });
}

type OverrideRequest = { itemId: string; itemRevision: string; overrideVersion?: number; resourceCd?: string | null; due?: GrindingPlanningBoardDueRequest; alternateRank?: number | null };

async function applyOverridesInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRevision: string; requests: readonly OverrideRequest[]; sourceRowIds: ReadonlyMap<string, string>; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>> }): Promise<PlanningState> {
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
  const desired: Array<{ request: OverrideRequest; currentOverride: ProductionScheduleGrindingPlanningBoardOverride | undefined; next: { overrideResourceCd: string | null; overrideDueDate: Date | null; alternateRank: number | null } }> = [];
  for (const request of params.requests) {
    const item = current.byItemId.get(request.itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (item.isCompleted) throw new ApiError(409, '完了済みの工程は変更できません', undefined, 'COMPLETED_ITEM');
    if (item.sourceRowId !== params.sourceRowIds.get(request.itemId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    assertItemRevision(request.itemRevision, item, request.overrideVersion);
    const currentOverride = current.overrides.get(request.itemId);
    let nextOverrideResource = currentOverride?.overrideResourceCd ?? null;
    let nextOverrideDue = currentOverride?.overrideDueDate ?? null;
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
      if (due !== undefined) nextOverrideDue = due;
    }
    const resourceChanged = request.resourceCd !== undefined && (nextOverrideResource ?? item.originalResourceCd) !== item.effectiveResourceCd;
    const dueChanged = request.due !== undefined && (ymd(nextOverrideDue) ?? item.originalDueDate) !== item.effectiveDueDate;
    desired.push({ request, currentOverride, next: { overrideResourceCd: nextOverrideResource, overrideDueDate: nextOverrideDue, alternateRank: request.alternateRank !== undefined ? request.alternateRank : resourceChanged || dueChanged ? null : currentOverride?.alternateRank ?? null } });
  }
  for (const update of desired) await writeOverrideIfChanged(params.client, params.siteKey, update.request.itemId, update.currentOverride, update.next);
  return current.state;
}

export async function updateGrindingPlanningBoardOverrides(params: { siteKey: string; sourceRevision: string; items: OverrideRequest[] }): Promise<{ sourceRevision: string }> {
  const itemIds = params.items.map((item) => item.itemId);
  if (new Set(itemIds).size !== itemIds.length) throw new ApiError(400, '対象アイテムが重複しています', undefined, 'DUPLICATE_ITEM');
  const sourceRowIds = await discoverSourceRows(itemIds);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  try {
    // Parent-row advisory/row locks and target item revisions provide the
    // write-conflict guarantee here. RepeatableRead avoids a PostgreSQL SSI
    // predicate lock on the small override table turning independent items
    // into a false serialization conflict.
    const state = await prisma.$transaction((client) => applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: params.items, sourceRowIds, policy }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { sourceRevision: boardRevision(state) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardRank(params: { siteKey: string; sourceRevision: string; itemId: string; itemRevision: string; overrideVersion?: number; alternateRank: number | null }): Promise<{ sourceRevision: string }> {
  if (params.alternateRank != null && (!Number.isInteger(params.alternateRank) || params.alternateRank < 1 || params.alternateRank > 10)) throw new ApiError(400, '個別順位は1以上10以下で指定してください', undefined, 'INVALID_ALTERNATE_RANK');
  const sourceRowIds = await discoverSourceRows([params.itemId]);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  try {
    const state = await prisma.$transaction((client) => applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: [{ itemId: params.itemId, itemRevision: params.itemRevision, overrideVersion: params.overrideVersion, alternateRank: params.alternateRank }], sourceRowIds, policy }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { sourceRevision: boardRevision(state) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardSeibanOrder(params: { siteKey: string; sourceRevision: string; fseibans: string[] }): Promise<{ sourceRevision: string; seibanOrder: string[] }> {
  const nextOrder = uniqueFseibans(params.fseibans);
  const rows = await readWinnerRows(prisma);
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
