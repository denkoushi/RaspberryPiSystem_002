import { randomUUID } from 'node:crypto';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride as Override } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { sortGrindingPlanningBoardProjectionItems } from '../grinding-planning-board-projection.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './piece-key.js';
import type { PieceAuditContext } from './piece-audit.js';

export const createLaneWrites = (overrides: Map<string, Override>) => ({
  original: new Map(overrides), pending: new Set<string>(), removed: new Set<string>(),
  laneVisits: new Map<string | null, number>()
});
export type LaneReplacementState = {
  pieces: GrindingPlanningBoardItem[]; seibanOrder?: readonly string[]; overrides: Map<string, Override>; stateVersionIncrements: number;
  laneWrites: ReturnType<typeof createLaneWrites>;
};

export async function replaceSiteItems(_tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, before: LaneReplacementState, siteKey: string, removed: string[], replacements: string[], audit?: PieceAuditContext, piecePositions?: ReadonlyMap<string, number>) {
  const started = performance.now();
  if (audit?.timing) audit.timing.replaceSiteItemsCount += 1;
  const selected = before.pieces.filter((item) => removed.includes(item.itemId));
  const sorted = before.pieces;
  const first = sorted.find((item) => removed.includes(item.itemId));
  if (!first) return;
  const inherited = before.overrides.get(first.itemId) ?? before.overrides.get(sessakuPieceParentItemId(key));
  const inheritedRank = inherited?.alternateRank ?? null;
  // Every replacement takes this site's first selected item's placement and override.
  const parentItemId = sessakuPieceParentItemId(key);
  const replacementItems = replacements.map((id, index) => ({
    ...first, itemId: id, kind: id.startsWith('piece:') ? 'piece' as const : 'row' as const,
    parentItemId: id.startsWith('piece:') ? parentItemId : undefined,
    piecePosition: id.startsWith('piece:') ? piecePositions?.get(id) ?? (first.piecePosition ?? 1) + index : undefined
  }));
  const next: GrindingPlanningBoardItem[] = [];
  for (const item of sorted) {
    if (item.itemId === first.itemId) next.push(...replacementItems);
    if (!removed.includes(item.itemId)) next.push(piecePositions?.has(item.itemId)
      ? { ...item, piecePosition: piecePositions.get(item.itemId) } : item);
  }
  const resources = new Set(selected.map((item) => item.effectiveResourceCd));

  const updatedAt = new Date();
  for (const resource of resources) {
    before.laneWrites.laneVisits.set(resource, (before.laneWrites.laneVisits.get(resource) ?? 0) + 1);
    const allLane = next.filter((item) => item.effectiveResourceCd === resource);
    const lane = allLane.filter((item) => !item.isCompleted);
    // Apply current in-memory ranks, including earlier replacements in this transaction.
    // Completed rows keep their ranks in both candidates, just as the old writer did.
    const inheritedLane = allLane.map((item) => {
      const own = before.overrides.get(item.itemId);
      return { ...item, alternateRank: replacements.includes(item.itemId) ? inheritedRank : own ? own.alternateRank : item.alternateRank };
    });
    const denseRanks = new Map(lane.map((item, index) => [item.itemId, index + 1]));
    const denseLane = inheritedLane.map((item) => ({ ...item, alternateRank: denseRanks.get(item.itemId) ?? item.alternateRank }));
    const order = (items: GrindingPlanningBoardItem[]) => sortGrindingPlanningBoardProjectionItems(items, before.seibanOrder ?? [], 'resource', 'alternate').map((item) => item.itemId);
    const inheritedOrder = order(inheritedLane), denseOrder = order(denseLane);
    const fallback = inheritedOrder.some((id, index) => id !== denseOrder[index]);
    if (fallback && audit?.timing) audit.timing.laneRerankFallbackCount += 1;
    for (const [index, item] of lane.entries()) {
      if (!fallback && !replacements.includes(item.itemId)) continue;
      const isReplacement = replacements.includes(item.itemId);
      const own = isReplacement ? inherited : before.overrides.get(item.itemId);
      const data = {
        overrideResourceCd: own?.overrideResourceCd ?? null, overrideDueDate: own?.overrideDueDate ?? null,
        dueDateCleared: own?.dueDateCleared ?? null, orderPinned: own?.orderPinned ?? false,
        specialDueKind: own?.specialDueKind ?? null, specialDueExpiresAt: own?.specialDueExpiresAt ?? null,
        alternateRank: fallback ? index + 1 : inheritedRank
      };
      const existing = before.overrides.get(item.itemId);
      const id = existing?.id ?? randomUUID();
      before.laneWrites.pending.add(item.itemId);
      before.overrides.set(item.itemId, {
        id: existing?.id ?? id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.itemId,
        ...data, version: (before.laneWrites.original.get(item.itemId)?.version ?? 0) + 1, createdAt: existing?.createdAt ?? updatedAt, updatedAt
      });
    }
  }
  for (const id of removed.filter((id) => id.startsWith('piece:'))) {
    before.laneWrites.removed.add(id);
    before.laneWrites.pending.delete(id);
  }
  before.pieces = next;
  for (const id of removed.filter((id) => id.startsWith('piece:'))) before.overrides.delete(id);
  before.stateVersionIncrements += 1;
  if (audit?.timing) audit.timing.rerankMs += performance.now() - started;
}

const samePlacement = (a: Override, b: Override) =>
  a.alternateRank === b.alternateRank && a.overrideResourceCd === b.overrideResourceCd
  && a.overrideDueDate?.getTime() === b.overrideDueDate?.getTime() && a.dueDateCleared === b.dueDateCleared
  && a.orderPinned === b.orderPinned && a.specialDueKind === b.specialDueKind
  && a.specialDueExpiresAt?.getTime() === b.specialDueExpiresAt?.getTime();

/** Flush after every process has replaced its items, under the existing board locks. */
export async function flushSiteItems(tx: Prisma.TransactionClient, states: Map<string, LaneReplacementState>, audit?: PieceAuditContext) {
  const changed: Override[] = [];
  const removedSites: string[] = [], removedKeys: string[] = [];
  for (const [siteKey, state] of states) {
    for (const visits of state.laneWrites.laneVisits.values()) if (audit?.timing) {
      audit.timing.laneWriteCount += 1;
      audit.timing.repeatedLaneCount += visits - 1;
    }
    for (const itemKey of state.laneWrites.removed) {
      // A later replacement may reintroduce a removed item.
      if (!state.laneWrites.pending.has(itemKey)) { removedSites.push(siteKey); removedKeys.push(itemKey); }
    }
    for (const itemKey of state.laneWrites.pending) {
      const row = state.overrides.get(itemKey)!;
      const original = state.laneWrites.original.get(itemKey);
      if (!original || !samePlacement(original, row)) changed.push(row);
    }
  }
  const updatedAt = new Date();
  if (changed.length) {
    const started = performance.now();
    // Each column is one bind, independent of lane size. Text dates preserve nulls
    // and the old writer's UTC date/timestamp casts with the PostgreSQL adapter.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride"
        ("id", "csvDashboardId", "siteKey", "itemKey", "overrideResourceCd", "overrideDueDate", "dueDateCleared",
         "orderPinned", "specialDueKind", "specialDueExpiresAt", "alternateRank", "updatedAt")
      SELECT k.id, ${PRODUCTION_SCHEDULE_DASHBOARD_ID}, k.site, k.item, k.resource, k.due::date, k.cleared,
        k.pinned, k.kind, k.expires::timestamp, k.rank, ${updatedAt}::timestamp
      FROM unnest(${changed.map((r) => r.id)}::text[], ${changed.map((r) => r.siteKey)}::text[],
        ${changed.map((r) => r.itemKey)}::text[], ${changed.map((r) => r.overrideResourceCd)}::text[],
        ${changed.map((r) => r.overrideDueDate?.toISOString() ?? null)}::text[], ${changed.map((r) => r.dueDateCleared)}::boolean[],
        ${changed.map((r) => r.orderPinned)}::boolean[], ${changed.map((r) => r.specialDueKind)}::text[],
        ${changed.map((r) => r.specialDueExpiresAt?.toISOString() ?? null)}::text[], ${changed.map((r) => r.alternateRank)}::integer[])
        AS k(id, site, item, resource, due, cleared, pinned, kind, expires, rank)
      WHERE true
      ON CONFLICT ("csvDashboardId", "siteKey", "itemKey") DO UPDATE SET
        "overrideResourceCd" = EXCLUDED."overrideResourceCd", "overrideDueDate" = EXCLUDED."overrideDueDate",
        "dueDateCleared" = EXCLUDED."dueDateCleared", "orderPinned" = EXCLUDED."orderPinned",
        "specialDueKind" = EXCLUDED."specialDueKind", "specialDueExpiresAt" = EXCLUDED."specialDueExpiresAt",
        "alternateRank" = EXCLUDED."alternateRank", "updatedAt" = EXCLUDED."updatedAt",
        "version" = "ProductionScheduleGrindingPlanningBoardOverride"."version" + 1
    `);
    if (audit?.timing) {
      audit.timing.placementUpsertMs += performance.now() - started;
      audit.timing.upsertCount += changed.length;
      audit.timing.placementUpsertSqlCount += 1;
    }
  }
  if (removedKeys.length) await tx.$executeRaw(Prisma.sql`
    DELETE FROM "ProductionScheduleGrindingPlanningBoardOverride" AS o
    USING unnest(${removedSites}::text[], ${removedKeys}::text[]) AS k(site, item)
    WHERE o."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND o."siteKey" = k.site AND o."itemKey" = k.item
  `);
}
