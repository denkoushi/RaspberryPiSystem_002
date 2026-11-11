// Frozen VALUES writer from ae205f4d: test oracle, never used by production.
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { sessakuPieceParentItemId, type SessakuPieceLogicalKey } from '../piece-key.js';
import type { PieceAuditContext } from '../piece-audit.js';
import type { LaneReplacementState } from '../piece-lane-writes.js';

export async function legacyReplaceSiteItems(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, before: LaneReplacementState, siteKey: string, removed: string[], replacements: string[], audit?: PieceAuditContext) {
  const started = performance.now();
  if (audit?.timing) audit.timing.replaceSiteItemsCount += 1;
  const selected = before.pieces.filter((item) => removed.includes(item.itemId));
  const sorted = before.pieces;
  const first = sorted.find((item) => removed.includes(item.itemId));
  if (!first) return;
  const inherited = before.overrides.get(first.itemId) ?? before.overrides.get(sessakuPieceParentItemId(key));
  // Every replacement takes this site's first selected item's placement and override.
  const replacementItems = replacements.map((id) => ({ ...first, itemId: id }));
  const next: GrindingPlanningBoardItem[] = [];
  for (const item of sorted) {
    if (item.itemId === first.itemId) next.push(...replacementItems);
    if (!removed.includes(item.itemId)) next.push(item);
  }
  const resources = new Set(selected.map((item) => item.effectiveResourceCd));
  const values: Prisma.Sql[] = [];
  const updatedAt = new Date();
  for (const resource of resources) {
    const lane = next.filter((item) => item.effectiveResourceCd === resource && !item.isCompleted);
    for (const [index, item] of lane.entries()) {
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
      const id = randomUUID();
      values.push(Prisma.sql`(${id}, ${PRODUCTION_SCHEDULE_DASHBOARD_ID}, ${siteKey}, ${item.itemId},
        ${data.overrideResourceCd}::text, ${data.overrideDueDate}::date, ${data.dueDateCleared}::boolean,
        ${data.orderPinned}::boolean, ${data.specialDueKind}::text, ${data.specialDueExpiresAt}::timestamp,
        ${data.alternateRank}::integer, ${updatedAt}::timestamp)`);
      const existing = before.overrides.get(item.itemId);
      before.overrides.set(item.itemId, {
        id: existing?.id ?? id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.itemId,
        ...data, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? updatedAt, updatedAt
      });
    }
  }
  if (audit?.timing) audit.timing.rerankMs += performance.now() - started;
  // Bound bind parameters even when a lane contains many pieces.
  for (let offset = 0; offset < values.length; offset += 1000) {
    const chunk = values.slice(offset, offset + 1000);
    const writeStarted = performance.now();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride"
        ("id", "csvDashboardId", "siteKey", "itemKey", "overrideResourceCd", "overrideDueDate", "dueDateCleared",
         "orderPinned", "specialDueKind", "specialDueExpiresAt", "alternateRank", "updatedAt")
      VALUES ${Prisma.join(chunk)}
      ON CONFLICT ("csvDashboardId", "siteKey", "itemKey") DO UPDATE SET
        "overrideResourceCd" = EXCLUDED."overrideResourceCd", "overrideDueDate" = EXCLUDED."overrideDueDate",
        "dueDateCleared" = EXCLUDED."dueDateCleared", "orderPinned" = EXCLUDED."orderPinned",
        "specialDueKind" = EXCLUDED."specialDueKind", "specialDueExpiresAt" = EXCLUDED."specialDueExpiresAt",
        "alternateRank" = EXCLUDED."alternateRank", "updatedAt" = EXCLUDED."updatedAt",
        "version" = "ProductionScheduleGrindingPlanningBoardOverride"."version" + 1
    `);
    if (audit?.timing) {
      audit.timing.upsertCount += chunk.length;
      audit.timing.placementUpsertSqlCount += 1;
      audit.timing.placementUpsertMs += performance.now() - writeStarted;
    }
  }
  const removedPieces = removed.filter((id) => id.startsWith('piece:'));
  if (removedPieces.length) await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: { in: removedPieces } } });
  before.pieces = next;
  for (const id of removed.filter((id) => id.startsWith('piece:'))) before.overrides.delete(id);
  before.stateVersionIncrements += 1;
}
