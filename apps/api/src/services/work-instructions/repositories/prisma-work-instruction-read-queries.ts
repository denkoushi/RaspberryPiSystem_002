import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import {
  normalizeWorkInstructionGroupKey,
  normalizeWorkInstructionPartNumber,
  normalizeWorkInstructionShootingTarget
} from '../domain/normalization.js';
import type {
  WorkInstructionAssetStatus,
  WorkInstructionAssetView,
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionGroupedStepView,
  WorkInstructionJsonValue,
  WorkInstructionRowView,
  WorkInstructionSource,
  WorkInstructionStepView
} from '../domain/types.js';
import type {
  WorkInstructionDbClient,
  WorkInstructionAssetRecord,
  WorkInstructionRowRecord,
  WorkInstructionStepRecord
} from './prisma-work-instruction.persistence.types.js';
import type {
  WorkInstructionGroupsQuery,
  WorkInstructionRowsQuery
} from './work-instruction-repository.port.js';

function binaryCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bigintCompare(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toSafePositiveNumber(value: bigint, field: string): number {
  const numberValue = Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${field} exceeds the safe integer boundary`);
  }
  return numberValue;
}

function assertPage(input: { limit: number; offset: number }): void {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 500) {
    throw new Error('limit must be an integer between 1 and 500');
  }
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
}

function asJsonValue(value: unknown): WorkInstructionJsonValue {
  return value as WorkInstructionJsonValue;
}

function toAssetView(asset: WorkInstructionAssetRecord): WorkInstructionAssetView | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) return null;
  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType as WorkInstructionAssetView['mimeType'],
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    status: asset.status as WorkInstructionAssetStatus,
    createdAt: asset.createdAt,
    activatedAt: asset.activatedAt,
    deletePendingAt: asset.deletePendingAt
  };
}

function toStepView(step: WorkInstructionStepRecord): WorkInstructionStepView {
  const asset = step.asset && step.asset.status === 'ACTIVE' ? toAssetView(step.asset) : null;
  return {
    id: step.id,
    step: toSafePositiveNumber(step.step, 'step'),
    text: step.text,
    imageName: step.imageName,
    imageAssetId: asset?.assetId ?? null,
    imageStorageKey: asset?.storageKey ?? null,
    imageMimeType: asset?.mimeType ?? null,
    imageSha256: asset?.sha256 ?? null
  };
}

export function toWorkInstructionRowView(row: WorkInstructionRowRecord): WorkInstructionRowView {
  const source: WorkInstructionSource = {
    system: row.sourceSystem,
    list: row.sourceList,
    itemId: toSafePositiveNumber(row.sourceItemId, 'sourceItemId'),
    modified: row.sourceModified
  };
  return {
    id: row.id,
    source,
    partNumber: row.partNumber,
    shootingTarget: row.shootingTarget,
    contentHash: row.contentHash,
    rawManifest: asJsonValue(row.rawManifest),
    steps: [...row.steps].sort((left, right) => bigintCompare(left.step, right.step)).map(toStepView),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function compareSourceOrder(left: WorkInstructionSource, right: WorkInstructionSource): number {
  return left.itemId - right.itemId
    || binaryCompare(left.list, right.list)
    || binaryCompare(left.system, right.system);
}

type RowIdRecord = { id: string };
type GroupSummaryRecord = {
  partNumber: string;
  shootingTarget: string;
  rowCount: number;
  stepCount: number;
  latestModified: Date;
};

async function readRowsWithDb(
  db: WorkInstructionDbClient,
  input: WorkInstructionRowsQuery,
  applyPagination: boolean
): Promise<ReadonlyArray<WorkInstructionRowRecord>> {
  const filters = [Prisma.sql`TRUE`];
  if (input.partNumber) filters.push(Prisma.sql`row."partNumber" = ${input.partNumber}`);
  if (input.shootingTarget) filters.push(Prisma.sql`row."shootingTarget" = ${input.shootingTarget}`);
  if (input.includeUnclassified === false) {
    filters.push(Prisma.sql`row."partNumber" IS NOT NULL`, Prisma.sql`row."shootingTarget" IS NOT NULL`);
  }
  const pagination = applyPagination ? Prisma.sql`LIMIT ${input.limit} OFFSET ${input.offset}` : Prisma.empty;
  const idRecords = await db.$queryRaw<RowIdRecord[]>(Prisma.sql`
    SELECT row."id"
    FROM "WorkInstructionRow" AS row
    WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY row."sourceItemId" ASC,
             row."sourceList" COLLATE "C" ASC,
             row."sourceSystem" COLLATE "C" ASC
    ${pagination}
  `);
  const ids = idRecords.map((record) => record.id);
  if (ids.length === 0) return [];
  const rows = await db.workInstructionRow.findMany({
    where: { id: { in: ids } },
    include: { steps: { orderBy: { step: 'asc' }, include: { asset: true } } }
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export async function readWorkInstructionGroup(
  db: PrismaClient,
  input: { partNumber: string; shootingTarget: string }
): Promise<WorkInstructionGroupView | null> {
  const groupKey = normalizeWorkInstructionGroupKey(input.partNumber, input.shootingTarget);
  if (!groupKey) return null;
  return db.$transaction(async (tx) => {
    const rows = await readRowsWithDb(tx, {
      partNumber: groupKey.partNumber,
      shootingTarget: groupKey.shootingTarget,
      limit: 500,
      offset: 0
    }, false);
    if (rows.length === 0) return null;
    const rowViews = rows.map(toWorkInstructionRowView).sort((left, right) => compareSourceOrder(left.source, right.source));
    const steps: WorkInstructionGroupedStepView[] = [];
    for (const row of rowViews) {
      for (const step of row.steps) steps.push({ ...step, rowId: row.id, source: row.source });
    }
    return {
      partNumber: groupKey.partNumber,
      shootingTarget: groupKey.shootingTarget,
      rows: rowViews,
      steps
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}

export async function readWorkInstructionGroups(
  db: PrismaClient,
  input: WorkInstructionGroupsQuery
): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>> {
  assertPage(input);
  const partNumber = input.partNumber === undefined ? undefined : normalizeWorkInstructionPartNumber(input.partNumber);
  const shootingTarget = input.shootingTarget === undefined ? undefined : normalizeWorkInstructionShootingTarget(input.shootingTarget);
  if (input.partNumber !== undefined && !partNumber) return [];
  if (input.shootingTarget !== undefined && !shootingTarget) return [];
  return db.$transaction(async (tx) => {
    const filters = [Prisma.sql`row."partNumber" IS NOT NULL`, Prisma.sql`row."shootingTarget" IS NOT NULL`];
    if (partNumber) filters.push(Prisma.sql`row."partNumber" = ${partNumber}`);
    if (shootingTarget) filters.push(Prisma.sql`row."shootingTarget" = ${shootingTarget}`);
    return tx.$queryRaw<GroupSummaryRecord[]>(Prisma.sql`
      SELECT row."partNumber" AS "partNumber",
             row."shootingTarget" AS "shootingTarget",
             COUNT(DISTINCT row."id")::int AS "rowCount",
             COUNT(step."id")::int AS "stepCount",
             MAX(row."sourceModified") AS "latestModified"
      FROM "WorkInstructionRow" AS row
      LEFT JOIN "WorkInstructionStep" AS step ON step."rowId" = row."id"
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY row."partNumber", row."shootingTarget"
      ORDER BY row."partNumber" COLLATE "C" ASC, row."shootingTarget" COLLATE "C" ASC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}

export async function readWorkInstructionRows(
  db: PrismaClient,
  input: WorkInstructionRowsQuery
): Promise<ReadonlyArray<WorkInstructionRowView>> {
  assertPage(input);
  const partNumber = input.partNumber === undefined ? undefined : normalizeWorkInstructionPartNumber(input.partNumber);
  const shootingTarget = input.shootingTarget === undefined ? undefined : normalizeWorkInstructionShootingTarget(input.shootingTarget);
  if (input.partNumber !== undefined && !partNumber) return [];
  if (input.shootingTarget !== undefined && !shootingTarget) return [];
  return db.$transaction(async (tx) => {
    const rows = await readRowsWithDb(tx, {
      ...input,
      partNumber: partNumber ?? undefined,
      shootingTarget: shootingTarget ?? undefined
    }, true);
    return rows.map(toWorkInstructionRowView);
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}

export async function readWorkInstructionAsset(
  db: PrismaClient,
  assetId: string
): Promise<WorkInstructionAssetView | null> {
  if (!assetId.trim()) return null;
  const asset = await db.workInstructionAsset.findFirst({ where: { id: assetId, status: 'ACTIVE' } });
  return asset ? toAssetView(asset) : null;
}
