import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import type { LeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import { readGrindingPlanningBoardSnapshotGenerationToken } from '../leaderboard/leaderboard-shell-snapshot-generation.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import { type DbClient, type PlanningSnapshotGenerationDetails, type PlanningSnapshotPayload, type PlanningState, type ReusablePlanningPayload, uniqueFseibans } from './shared.js';

const PLANNING_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
export const fallbackPlanningSnapshotStore = createInMemoryLeaderboardShellSnapshotStore({
  defaultTtlMs: PLANNING_SNAPSHOT_TTL_MS
});
// Retain completed payloads independently of cursor TTL, isolated per store.
export const REUSABLE_PLANNING_PAYLOAD_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_REUSABLE_PLANNING_PAYLOADS = 16;
export const reusablePlanningPayloads = new WeakMap<LeaderboardShellSnapshotStore, Map<string, ReusablePlanningPayload>>();

export function stateOrder(state: { seibanOrder: Prisma.JsonValue }): string[] {
  return Array.isArray(state.seibanOrder) ? uniqueFseibans(state.seibanOrder.filter((value): value is string => typeof value === 'string')) : [];
}

function orderHash(order: readonly string[]): string { return createHash('sha256').update(JSON.stringify(order)).digest('hex'); }

export function boardRevision(state: PlanningState): string { return JSON.stringify({ boardVersion: state.version, orderHash: orderHash(stateOrder(state)) }); }

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

export function assertBoardRevision(expected: string, current: PlanningState): void {
  const parsed = parseBoardRevision(expected);
  if (parsed.orderHash !== orderHash(stateOrder(current)) || (parsed.boardVersion != null && parsed.boardVersion !== current.version)) throw new ApiError(409, '製番順が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ORDER');
}

export async function getOrCreateState(siteKey: string, fseibans: readonly string[], client: DbClient = prisma): Promise<PlanningState> {
  const existing = await client.productionScheduleGrindingPlanningBoardState.findUnique({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  if (existing) return existing as PlanningState;
  let order: string[] = [];
  if (client === prisma) {
    const { getProductionScheduleSearchState } = await import('../production-schedule-search-state.service.js');
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

export function isPlanningSnapshotPayload(value: unknown): value is PlanningSnapshotPayload {
  if (value == null || typeof value !== 'object') return false;
  const payload = value as Partial<PlanningSnapshotPayload>;
  return Array.isArray(payload.items) && Array.isArray(payload.load) &&
    typeof payload.unknownRequiredMinutesCount === 'number' &&
    payload.seibanProgress != null && typeof payload.seibanProgress === 'object' &&
    Array.isArray(payload.resources);
}

export async function readPlanningSnapshotGenerationDetails(siteKey: string): Promise<PlanningSnapshotGenerationDetails> {
  const [leaderboardGeneration, state, overrides, resources, machineNames] = await Promise.all([
    readGrindingPlanningBoardSnapshotGenerationToken(),
    prisma.productionScheduleGrindingPlanningBoardState.findUnique({
      where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } },
      select: { version: true, updatedAt: true }
    }),
    prisma.productionScheduleGrindingPlanningBoardOverride.aggregate({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey },
      _count: { _all: true },
      _max: { updatedAt: true }
    }),
    prisma.productionScheduleResourceMaster.aggregate({
      _count: { _all: true },
      _max: { updatedAt: true }
    }),
    prisma.productionScheduleSeibanMachineNameSupplement.aggregate({
      where: { sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
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
      overrideUpdatedAt: overrides._max.updatedAt?.toISOString() ?? '',
      resourceCount: resources._count._all,
      resourceUpdatedAt: resources._max.updatedAt?.toISOString() ?? '',
      machineNameCount: machineNames._count._all,
      machineNameUpdatedAt: machineNames._max.updatedAt?.toISOString() ?? '',
      splitEnabled: isProductionScheduleOrderSplitEnabled()
    }),
    leaderboardGenerationToken: leaderboardGeneration,
    boardVersion,
    boardUpdatedAt
  };
}

export async function readPlanningSnapshotGenerationToken(siteKey: string): Promise<string> {
  return (await readPlanningSnapshotGenerationDetails(siteKey)).generationToken;
}

export function isPlanningStateAlignedWithGeneration(
  state: PlanningState,
  generation: PlanningSnapshotGenerationDetails
): boolean {
  const stateUpdatedAt = state.updatedAt instanceof Date ? state.updatedAt.toISOString() : '';
  return state.version === generation.boardVersion && stateUpdatedAt === generation.boardUpdatedAt;
}

export async function ensurePlanningBoardState(siteKey: string): Promise<void> {
  await getOrCreateState(siteKey, [], prisma);
}

export async function lockState(client: Prisma.TransactionClient, siteKey: string): Promise<PlanningState> {
  const rows = await client.$queryRaw<PlanningState[]>`
    SELECT "id", "version", "seibanOrder" FROM "ProductionScheduleGrindingPlanningBoardState"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey} FOR UPDATE
  `;
  if (!rows[0]) throw new ApiError(409, 'ボード状態が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
  return rows[0];
}

export async function readState(client: Prisma.TransactionClient, siteKey: string): Promise<PlanningState> {
  const state = await client.productionScheduleGrindingPlanningBoardState.findUnique({
    where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } }
  });
  if (!state) throw new ApiError(409, 'ボード状態が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
  return state as PlanningState;
}
