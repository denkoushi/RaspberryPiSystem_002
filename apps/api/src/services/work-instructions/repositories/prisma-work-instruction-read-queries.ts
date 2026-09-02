import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';

import {
  normalizeWorkInstructionGroupKey,
  normalizeWorkInstructionPartNumber,
  normalizeWorkInstructionShootingTarget
} from '../domain/normalization.js';
import type { WorkInstructionMemoOverride, WorkInstructionOverlayElement } from '../domain/editing.js';
import { toEditRevisionView, workInstructionEditRevisionInclude } from './prisma-work-instruction-edit.persistence.js';
import {
  workInstructionSourceVersionInclude
} from './prisma-work-instruction-version.persistence.js';
import type {
  WorkInstructionAssetStatus,
  WorkInstructionAssetView,
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionGroupedStepView,
  WorkInstructionJsonValue,
  WorkInstructionRowView,
  WorkInstructionSource,
  WorkInstructionStepView,
  WorkInstructionOverlayAssetView
} from '../domain/types.js';
import type {
  WorkInstructionDbClient,
  WorkInstructionAssetRecord,
  WorkInstructionRowRecord,
  WorkInstructionStepRecord
} from './prisma-work-instruction.persistence.types.js';
import type {
  WorkInstructionGroupsQuery,
  WorkInstructionPartCandidatesQuery,
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

type PublishedPublicationRecord = Prisma.WorkInstructionSourcePublicationGetPayload<{
  include: {
    row: { select: {
      id: true;
      sourceSystem: true;
      sourceList: true;
      sourceItemId: true;
      updatedAt: true;
    } };
    publishedVersion: { include: typeof workInstructionSourceVersionInclude };
    publishedRevision: { include: typeof workInstructionEditRevisionInclude };
  };
}>;

function toPublishedStepView(
  step: PublishedPublicationRecord['publishedVersion']['steps'][number],
  overlaysByStep: ReadonlyMap<number, ReadonlyArray<WorkInstructionOverlayElement>>,
  overlayAssets: Readonly<Record<string, WorkInstructionOverlayAssetView>>,
  memosByStep: ReadonlyMap<number, WorkInstructionMemoOverride>
): WorkInstructionStepView {
  const image = step.imageAsset?.status === 'ACTIVE' ? step.imageAsset : null;
  const sourceStep = toSafePositiveNumber(step.step, 'step');
  const memo = memosByStep.get(sourceStep);
  return {
    id: step.id,
    step: sourceStep,
    text: step.text,
    imageName: step.imageName,
    imageAssetId: image?.id ?? null,
    imageStorageKey: image?.storageKey ?? null,
    imageMimeType: image?.mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
      ? image.mimeType as WorkInstructionStepView['imageMimeType']
      : null,
    imageSha256: step.imageSha256 ?? image?.sha256 ?? null,
    ...(memo ? { memoOverride: memo.text, memoMigrationState: memo.migrationState } : {}),
    overlays: overlaysByStep.get(sourceStep) ?? [],
    overlayAssets
  };
}

function publishedMemoOverridesByStep(
  publication: PublishedPublicationRecord
): ReadonlyMap<number, WorkInstructionMemoOverride> {
  if (!publication.publishedRevision) return new Map();
  const result = new Map<number, WorkInstructionMemoOverride>();
  for (const memo of toEditRevisionView(publication.publishedRevision).memoOverrides ?? []) {
    if (memo.sourceStep == null || memo.migrationState !== 'MIGRATED') continue;
    result.set(memo.sourceStep, memo);
  }
  return result;
}

function publishedOverlaysByStep(
  publication: PublishedPublicationRecord
): ReadonlyMap<number, ReadonlyArray<WorkInstructionOverlayElement>> {
  if (!publication.publishedRevision) return new Map();
  const groups = new Map<number, WorkInstructionOverlayElement[]>();
  for (const overlay of toEditRevisionView(publication.publishedRevision).overlays) {
    if (overlay.sourceStep == null || overlay.migrationState === 'SKIPPED' || overlay.migrationState === 'UNASSIGNED') continue;
    const values = groups.get(overlay.sourceStep) ?? [];
    values.push(overlay);
    groups.set(overlay.sourceStep, values);
  }
  return groups;
}

function publishedOverlayAssets(
  publication: PublishedPublicationRecord
): Readonly<Record<string, WorkInstructionOverlayAssetView>> {
  const assets = publication.publishedRevision?.overlays
    .map((overlay) => overlay.editAsset)
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset && asset.status === 'ACTIVE')) ?? [];
  return Object.fromEntries(assets.map((asset) => [asset.id, {
      assetId: asset.id,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      url: `/api/work-instructions/edit-assets/${asset.id}`
    } satisfies WorkInstructionOverlayAssetView]));
}

function toPublishedRowView(publication: PublishedPublicationRecord): WorkInstructionRowView {
  const version = publication.publishedVersion;
  const overlaysByStep = publishedOverlaysByStep(publication);
  const overlayAssets = publishedOverlayAssets(publication);
  const memosByStep = publishedMemoOverridesByStep(publication);
  return {
    id: publication.row.id,
    source: {
      system: publication.row.sourceSystem,
      list: publication.row.sourceList,
      itemId: toSafePositiveNumber(publication.row.sourceItemId, 'sourceItemId'),
      modified: version.sourceModified
    },
    partNumber: version.partNumber,
    shootingTarget: version.shootingTarget,
    contentHash: version.contentHash,
    rawManifest: asJsonValue(version.rawManifest),
    steps: version.steps.map((step) => toPublishedStepView(step, overlaysByStep, overlayAssets, memosByStep)),
    createdAt: version.createdAt,
    updatedAt: publication.row.updatedAt
  };
}

const publishedPublicationInclude = {
  row: { select: { id: true, sourceSystem: true, sourceList: true, sourceItemId: true, updatedAt: true } },
  publishedVersion: { include: workInstructionSourceVersionInclude },
  publishedRevision: { include: workInstructionEditRevisionInclude }
} as const;

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
      steps,
      updateAvailable: false
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
  const published = await db.$transaction(async (tx) => {
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
  return published;
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

/**
 * Public kiosk projection. Source ingestion continues to update WorkInstructionRow,
 * while this query follows the explicit publication pointer and overlays.
 */
export async function readPublishedWorkInstructionGroup(
  db: PrismaClient,
  input: { partNumber: string; shootingTarget: string }
): Promise<WorkInstructionGroupView | null> {
  const groupKey = normalizeWorkInstructionGroupKey(input.partNumber, input.shootingTarget);
  if (!groupKey) return null;
  const published = await db.$transaction(async (tx) => {
    const publications = await tx.workInstructionSourcePublication.findMany({
      where: {
        publishedVersion: {
          partNumber: groupKey.partNumber,
          shootingTarget: groupKey.shootingTarget
        }
      },
      include: publishedPublicationInclude
    });
    const publishedRows = publications.map(toPublishedRowView);
    const publishedIds = new Set(publishedRows.map((row) => row.id));
    const updateAvailable = publications.some((publication) => publication.latestVersionId !== publication.publishedVersionId);
    // During rollout some rows may still be legacy latest-only records. The
    // fallback is deliberately NOT EXISTS publication, rather than merely
    // "not in the selected published ids": a row with a publication whose
    // mutable latest projection moved to another group must not leak into the
    // published group being read.
    const legacyRows = (await tx.workInstructionRow.findMany({
      where: {
        partNumber: groupKey.partNumber,
        shootingTarget: groupKey.shootingTarget,
        publication: { is: null }
      },
      include: { steps: { orderBy: { step: 'asc' }, include: { asset: true } } }
    }))
      .filter((row) => !publishedIds.has(row.id))
      .map(toWorkInstructionRowView);
    const rows = [...publishedRows, ...legacyRows]
      .sort((left, right) => compareSourceOrder(left.source, right.source));
    if (rows.length === 0) return null;
    const steps: WorkInstructionGroupedStepView[] = [];
    for (const row of rows) {
      for (const step of row.steps) steps.push({ ...step, rowId: row.id, source: row.source });
    }
    return {
      partNumber: groupKey.partNumber,
      shootingTarget: groupKey.shootingTarget,
      rows,
      steps,
      updateAvailable
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  if (published) return published;
  // Before the sidecar migration has started the whole table is legacy. Once
  // any publication exists, a row with no publication is already covered by
  // the NOT EXISTS fallback above; returning the mutable projection here
  // would leak a published row that moved groups after re-import.
  const publicationCount = await db.workInstructionSourcePublication.count();
  return publicationCount === 0 ? readWorkInstructionGroup(db, input) : null;
}

/** Public group summaries follow published source metadata, not pending latest imports. */
export async function readPublishedWorkInstructionGroups(
  db: PrismaClient,
  input: WorkInstructionGroupsQuery
): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>> {
  assertPage(input);
  const partNumber = input.partNumber === undefined ? undefined : normalizeWorkInstructionPartNumber(input.partNumber);
  const shootingTarget = input.shootingTarget === undefined ? undefined : normalizeWorkInstructionShootingTarget(input.shootingTarget);
  if (input.partNumber !== undefined && !partNumber) return [];
  if (input.shootingTarget !== undefined && !shootingTarget) return [];
  const rows = await db.$transaction(async (tx) => {
    const filters = [Prisma.sql`version."partNumber" IS NOT NULL`, Prisma.sql`version."shootingTarget" IS NOT NULL`];
    if (partNumber) filters.push(Prisma.sql`version."partNumber" = ${partNumber}`);
    if (shootingTarget) filters.push(Prisma.sql`version."shootingTarget" = ${shootingTarget}`);
    const published = await tx.$queryRaw<GroupSummaryRecord[]>(Prisma.sql`
      SELECT version."partNumber" AS "partNumber",
             version."shootingTarget" AS "shootingTarget",
             COUNT(DISTINCT publication."rowId")::int AS "rowCount",
             COUNT(step."id")::int AS "stepCount",
             MAX(version."sourceModified") AS "latestModified"
      FROM "WorkInstructionSourcePublication" AS publication
      JOIN "WorkInstructionSourceVersion" AS version
        ON version."id" = publication."publishedVersionId"
      LEFT JOIN "WorkInstructionSourceVersionStep" AS step
        ON step."sourceVersionId" = version."id"
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY version."partNumber", version."shootingTarget"
    `);
    const legacyFilters = [Prisma.sql`row."partNumber" IS NOT NULL`, Prisma.sql`row."shootingTarget" IS NOT NULL`];
    if (partNumber) legacyFilters.push(Prisma.sql`row."partNumber" = ${partNumber}`);
    if (shootingTarget) legacyFilters.push(Prisma.sql`row."shootingTarget" = ${shootingTarget}`);
    const legacy = await tx.$queryRaw<GroupSummaryRecord[]>(Prisma.sql`
      SELECT row."partNumber" AS "partNumber",
             row."shootingTarget" AS "shootingTarget",
             COUNT(DISTINCT row."id")::int AS "rowCount",
             COUNT(step."id")::int AS "stepCount",
             MAX(row."sourceModified") AS "latestModified"
      FROM "WorkInstructionRow" AS row
      LEFT JOIN "WorkInstructionStep" AS step ON step."rowId" = row."id"
      LEFT JOIN "WorkInstructionSourcePublication" AS publication ON publication."rowId" = row."id"
      WHERE ${Prisma.join(legacyFilters, ' AND ')}
        AND publication."rowId" IS NULL
      GROUP BY row."partNumber", row."shootingTarget"
    `);
    const grouped = new Map<string, GroupSummaryRecord>();
    for (const summary of [...published, ...legacy]) {
      const key = `${summary.partNumber}\u0000${summary.shootingTarget}`;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { ...summary });
        continue;
      }
      current.rowCount += summary.rowCount;
      current.stepCount += summary.stepCount;
      if (summary.latestModified > current.latestModified) current.latestModified = summary.latestModified;
    }
    return [...grouped.values()].sort((left, right) =>
      binaryCompare(left.partNumber, right.partNumber) || binaryCompare(left.shootingTarget, right.shootingTarget)
    );
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  return rows.slice(input.offset, input.offset + input.limit);
}

type PartCandidateRecord = {
  partNumber: string;
  shootingTarget: string;
  partName: string | null;
};

function escapeLikePrefix(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function readPublishedPartCandidatesAtPrefix(
  db: PrismaClient,
  prefix: string,
  limit: number,
  offset: number
): Promise<{ candidates: Array<{ partNumber: string; partName: string | null; shootingTargets: string[] }>; hasMore: boolean }> {
  const pattern = `${escapeLikePrefix(prefix)}%`;
  const records = await db.$queryRaw<PartCandidateRecord[]>(Prisma.sql`
    WITH public_groups AS (
      SELECT version."partNumber" AS "partNumber", version."shootingTarget" AS "shootingTarget"
      FROM "WorkInstructionSourcePublication" AS publication
      JOIN "WorkInstructionSourceVersion" AS version
        ON version."id" = publication."publishedVersionId"
      WHERE version."partNumber" IS NOT NULL
        AND version."shootingTarget" IS NOT NULL
      UNION
      SELECT row."partNumber" AS "partNumber", row."shootingTarget" AS "shootingTarget"
      FROM "WorkInstructionRow" AS row
      LEFT JOIN "WorkInstructionSourcePublication" AS publication ON publication."rowId" = row."id"
      WHERE row."partNumber" IS NOT NULL
        AND row."shootingTarget" IS NOT NULL
        AND publication."rowId" IS NULL
    ), candidate_parts AS (
      SELECT "partNumber"
      FROM public_groups
      WHERE "partNumber" LIKE ${pattern} ESCAPE '\\'
      GROUP BY "partNumber"
      ORDER BY "partNumber" COLLATE "C" ASC
      LIMIT ${limit + 1} OFFSET ${offset}
    )
    SELECT candidates."partNumber" AS "partNumber",
           groups."shootingTarget" AS "shootingTarget",
           (
             SELECT MIN(NULLIF(TRIM(schedule."rowData"->>'FHINMEI'), ''))
             FROM "CsvDashboardRow" AS schedule
             WHERE schedule."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
               AND UPPER(TRIM(schedule."rowData"->>'FHINCD')) = candidates."partNumber"
           ) AS "partName"
    FROM candidate_parts AS candidates
    JOIN public_groups AS groups ON groups."partNumber" = candidates."partNumber"
    ORDER BY candidates."partNumber" COLLATE "C" ASC, groups."shootingTarget" COLLATE "C" ASC
  `);

  const byPartNumber = new Map<string, { partNumber: string; partName: string | null; shootingTargets: string[] }>();
  for (const record of records) {
    const current = byPartNumber.get(record.partNumber);
    if (current) {
      current.shootingTargets.push(record.shootingTarget);
    } else {
      byPartNumber.set(record.partNumber, {
        partNumber: record.partNumber,
        partName: record.partName?.trim() || null,
        shootingTargets: [record.shootingTarget]
      });
    }
  }
  const allCandidates = [...byPartNumber.values()];
  return { candidates: allCandidates.slice(0, limit), hasMore: allCandidates.length > limit };
}

export async function readPublishedWorkInstructionPartCandidates(
  db: PrismaClient,
  input: WorkInstructionPartCandidatesQuery
) {
  assertPage(input);
  const normalized = normalizeWorkInstructionPartNumber(input.prefix) ?? '';
  const characters = Array.from(normalized);
  if (characters.length < 2) return { matchedPrefix: null, candidates: [], hasMore: false };

  const minimumLength = input.fallback ? 2 : characters.length;
  for (let length = characters.length; length >= minimumLength; length -= 1) {
    const matchedPrefix = characters.slice(0, length).join('');
    const page = await readPublishedPartCandidatesAtPrefix(db, matchedPrefix, input.limit, input.offset);
    if (page.candidates.length > 0) return { matchedPrefix, ...page };
  }
  return { matchedPrefix: null, candidates: [], hasMore: false };
}
