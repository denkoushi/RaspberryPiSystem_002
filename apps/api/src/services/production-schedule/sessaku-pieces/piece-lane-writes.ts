import { mixedPlanningLane, readPlanningTestBars } from '../grinding-planning-board/test-bars.js';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride as Override } from '@prisma/client';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardTestBar, GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './piece-key.js';
import type { PieceAuditContext } from './piece-audit.js';

export const createLaneWrites = (overrides: Map<string, Override>) => ({
  original: new Map(overrides), pending: new Set<string>(), removed: new Set<string>(),
  laneVisits: new Map<string | null, number>()
});
export type LaneReplacementState = {
  pieces: GrindingPlanningBoardItem[]; overrides: Map<string, Override>; stateVersionIncrements: number;
  laneWrites: ReturnType<typeof createLaneWrites>;
  testBars?: GrindingPlanningBoardTestBar[];
  testBarRanks?: Map<string, number>;
};

export async function replaceSiteItems(_tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, before: LaneReplacementState, siteKey: string, removed: string[], replacements: string[], audit?: PieceAuditContext) {
  const started = performance.now();
  if (audit?.timing) audit.timing.replaceSiteItemsCount += 1;
  const selected = before.pieces.filter((item) => removed.includes(item.itemId));
  before.testBars ??= (await readPlanningTestBars(_tx, siteKey)).testBars;
  before.testBarRanks ??= new Map();
  const resourcesWithTests = new Set(before.testBars.filter((item) => !item.isCompleted).map((item) => item.resourceCd));
  const sorted: GrindingPlanningBoardBar[] = [];
  if (!resourcesWithTests.size) sorted.push(...before.pieces);
  else for (const resource of new Set(before.pieces.map((item) => item.effectiveResourceCd))) {
    if (resource && resourcesWithTests.has(resource)) sorted.push(...mixedPlanningLane(before.pieces, before.testBars, [], resource),
      ...before.pieces.filter((item) => item.effectiveResourceCd === resource && item.isCompleted));
    else sorted.push(...before.pieces.filter((item) => item.effectiveResourceCd === resource));
  }
  const first = sorted.find((item) => removed.includes(item.itemId));
  if (!first || first.kind === 'test') return;
  const inherited = before.overrides.get(first.itemId) ?? before.overrides.get(sessakuPieceParentItemId(key));
  // Every replacement takes this site's first selected item's placement and override.
  const replacementItems = replacements.map((id) => ({ ...first, itemId: id }));
  const next: GrindingPlanningBoardBar[] = [];
  for (const item of sorted) {
    if (item.itemId === first.itemId) next.push(...replacementItems);
    if (!removed.includes(item.itemId)) next.push(item);
  }
  const resources = new Set(selected.map((item) => item.effectiveResourceCd));

  const updatedAt = new Date();
  for (const resource of resources) {
    before.laneWrites.laneVisits.set(resource, (before.laneWrites.laneVisits.get(resource) ?? 0) + 1);
    const lane = next.filter((item) => (item.kind === 'test' ? item.resourceCd : item.effectiveResourceCd) === resource && !item.isCompleted);
    for (const [index, item] of lane.entries()) {
      if (item.kind === 'test') {
        before.testBarRanks.set(item.itemId, index + 1);
        item.alternateRank = index + 1;
        continue;
      }
      if (resource && resourcesWithTests.has(resource)) item.alternateRank = index + 1;
      const isReplacement = replacements.includes(item.itemId);
      const own = isReplacement ? inherited : before.overrides.get(item.itemId);
      const data = {
        overrideResourceCd: own?.overrideResourceCd ?? null, overrideDueDate: own?.overrideDueDate ?? null,
        dueDateCleared: own?.dueDateCleared ?? null, orderPinned: own?.orderPinned ?? false,
        specialDueKind: own?.specialDueKind ?? null, specialDueExpiresAt: own?.specialDueExpiresAt ?? null,
        alternateRank: index + 1
      };
      // Lane operations invalidate row revisions used by reorder and offline writes,
      // including rows whose dense rank stays the same.
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
  before.pieces = next.filter((item): item is GrindingPlanningBoardItem => item.kind !== 'test');
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
  const unchanged: Override[] = [];
  const changed: Override[] = [];
  const removedSites: string[] = [], removedKeys: string[] = [];
  for (const [siteKey, state] of states) {
    for (const [itemId, alternateRank] of state.testBarRanks ?? []) await tx.productionScheduleGrindingPlanningBoardTestBar.updateMany({
      where: { id: itemId.slice(5), csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, deletedAt: null },
      data: { alternateRank, version: { increment: 1 } }
    });
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
      (original && samePlacement(original, row) ? unchanged : changed).push(row);
    }
  }
  const updatedAt = new Date();
  if (unchanged.length) {
    const started = performance.now();
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ProductionScheduleGrindingPlanningBoardOverride" AS o
      SET "version" = o."version" + 1, "updatedAt" = ${updatedAt}::timestamp
      FROM unnest(${unchanged.map((r) => r.siteKey)}::text[], ${unchanged.map((r) => r.itemKey)}::text[]) AS k(site, item)
      WHERE o."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND o."siteKey" = k.site AND o."itemKey" = k.item
    `);
    if (audit?.timing) {
      audit.timing.versionUpdateMs += performance.now() - started;
      audit.timing.versionUpdateCount += unchanged.length;
      audit.timing.versionUpdateSqlCount += 1;
    }
  }
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
