import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { decideWorkInstructionRevision } from '../domain/update-policy.js';
import type {
  WorkInstructionApplyResult,
  WorkInstructionAssetInput,
  WorkInstructionCleanupCandidate,
  WorkInstructionGroupView,
  WorkInstructionPacket,
  WorkInstructionSource,
  WorkInstructionStagedAsset
} from '../domain/types.js';
import type {
  ApplyWorkInstructionPacketInput,
  CleanupWorkInstructionAssetsInput,
  RecordWorkInstructionImportMessageInput,
  StageWorkInstructionAssetsInput,
  WorkInstructionGroupsQuery,
  WorkInstructionImportMessagesQuery,
  WorkInstructionRepository,
  WorkInstructionRowsQuery
} from './work-instruction-repository.port.js';
import {
  readWorkInstructionAsset,
  readWorkInstructionGroup,
  readWorkInstructionGroups,
  readWorkInstructionRows
} from './prisma-work-instruction-read-queries.js';
import {
  readWorkInstructionImportMessage,
  readWorkInstructionImportMessages,
  recordWorkInstructionImportMessage
} from './prisma-work-instruction-import-messages.js';
import type {
  WorkInstructionDbClient,
  WorkInstructionLockedAsset
} from './prisma-work-instruction.persistence.types.js';

const SOURCE_LOCK_NAMESPACE = 0x57494e57;
const STAGED_ASSET_MAX_AGE_MS = 60 * 60 * 1000;

export type PrismaWorkInstructionRepositoryOptions = {
  db?: PrismaClient;
};

function assertAssetInput(asset: WorkInstructionAssetInput): void {
  if (!asset.assetId.trim() || !asset.storageKey.trim() || !asset.imageName.trim()) {
    throw new Error('asset id, storage key, and image name are required');
  }
  if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    throw new Error('asset size must be a positive integer');
  }
  if (!/^[0-9a-f]{64}$/i.test(asset.sha256)) throw new Error('asset sha256 must be a 64-character hex digest');
}

type StepCreateData = Prisma.WorkInstructionStepUncheckedCreateWithoutRowInput;

function buildStepCreateData(packet: WorkInstructionPacket, stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>): StepCreateData[] {
  const assetsByName = new Map<string, WorkInstructionStagedAsset>();
  for (const asset of stagedAssets) {
    if (assetsByName.has(asset.imageName)) throw new Error(`duplicate staged image name: ${asset.imageName}`);
    assetsByName.set(asset.imageName, asset);
  }
  return packet.steps.map((step) => {
    const asset = step.imageName === null ? null : assetsByName.get(step.imageName);
    if (step.imageName !== null && !asset) throw new Error(`missing staged asset for ${step.imageName}`);
    if (asset && step.imageHash && asset.sha256 !== step.imageHash) {
      throw new Error(`staged asset hash mismatch for ${step.imageName}`);
    }
    return {
      id: randomUUID(),
      step: BigInt(step.step),
      text: step.text,
      imageName: step.imageName,
      assetId: asset?.assetId ?? null
    };
  });
}

export class PrismaWorkInstructionRepository implements WorkInstructionRepository {
  private readonly db: PrismaClient;

  constructor(options: PrismaWorkInstructionRepositoryOptions = {}) {
    this.db = options.db ?? prisma;
  }

  async stageAssets(input: StageWorkInstructionAssetsInput): Promise<ReadonlyArray<WorkInstructionStagedAsset>> {
    const assets = [...input.assets];
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const asset of assets) {
      assertAssetInput(asset);
      if (seenIds.has(asset.assetId)) throw new Error(`duplicate asset id: ${asset.assetId}`);
      if (seenKeys.has(asset.storageKey)) throw new Error(`duplicate storage key: ${asset.storageKey}`);
      seenIds.add(asset.assetId);
      seenKeys.add(asset.storageKey);
    }
    const now = input.now ?? new Date();
    return this.db.$transaction(async (tx) => {
      const staged: WorkInstructionStagedAsset[] = [];
      for (const asset of assets) {
        const record = await tx.workInstructionAsset.upsert({
          where: { id: asset.assetId },
          create: {
            id: asset.assetId,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            status: 'STAGED',
            createdAt: now
          },
          update: {}
        });
        if (record.status !== 'STAGED' || record.storageKey !== asset.storageKey || record.sha256 !== asset.sha256) {
          throw new Error(`asset ${asset.assetId} is not the requested staged immutable asset`);
        }
        staged.push({ ...asset, status: 'STAGED', createdAt: record.createdAt });
      }
      return staged;
    });
  }

  async applyPacket(input: ApplyWorkInstructionPacketInput): Promise<WorkInstructionApplyResult> {
    const packet = input.packet;
    const stagedAssets = [...input.stagedAssets];
    const now = input.now ?? new Date();
    const steps = buildStepCreateData(packet, stagedAssets);
    const stagedIds = [...new Set(stagedAssets.map((asset) => asset.assetId))];

    return this.db.$transaction(async (tx) => {
      await this.lockSource(tx, packet.source);
      const current = await tx.workInstructionRow.findUnique({
        where: {
          sourceSystem_sourceList_sourceItemId: {
            sourceSystem: packet.source.system,
            sourceList: packet.source.list,
            sourceItemId: BigInt(packet.source.itemId)
          }
        }
      });
      const decision = decideWorkInstructionRevision(
        current ? { modified: current.sourceModified, contentHash: current.contentHash } : null,
        { modified: packet.source.modified, contentHash: packet.contentHash }
      );
      if (decision !== 'APPLY') {
        return {
          outcome: decision === 'CONFLICT' ? 'CONFLICT' : decision,
          rowId: current?.id ?? null,
          displacedAssetIds: []
        };
      }

      const lockedAssets = await this.lockStagedAssets(tx, stagedIds);
      this.assertStagedAssets(stagedAssets, lockedAssets);
      const oldAssetIds = current
        ? [...new Set((await tx.workInstructionStep.findMany({ where: { rowId: current.id }, select: { assetId: true } }))
          .map((step) => step.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)))]
        : [];
      const rowData = {
        sourceSystem: packet.source.system,
        sourceList: packet.source.list,
        sourceItemId: BigInt(packet.source.itemId),
        sourceModified: packet.source.modified,
        partNumber: packet.partNumber,
        shootingTarget: packet.shootingTarget,
        rawManifest: packet.rawManifest as unknown as Prisma.InputJsonValue,
        contentHash: packet.contentHash
      };
      const row = current
        ? await tx.workInstructionRow.update({
          where: { id: current.id },
          data: {
            ...rowData,
            steps: {
              deleteMany: {},
              create: steps
            }
          }
        })
        : await tx.workInstructionRow.create({
          data: {
            id: randomUUID(),
            ...rowData,
            steps: { create: steps }
          }
        });

      if (stagedIds.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WorkInstructionAsset"
          SET "status" = 'ACTIVE', "activatedAt" = ${now}, "updatedAt" = ${now}
          WHERE "id" IN (${Prisma.join(stagedIds)}) AND "status" = 'STAGED'
        `);
      }
      const displacedAssetRows = oldAssetIds.length === 0
        ? []
        : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "WorkInstructionAsset" AS asset
          SET "status" = 'DELETE_PENDING', "deletePendingAt" = ${now}, "updatedAt" = ${now}
          WHERE asset."id" IN (${Prisma.join(oldAssetIds)})
            AND asset."status" = 'ACTIVE'
            AND NOT EXISTS (
              SELECT 1 FROM "WorkInstructionStep" AS step
              WHERE step."assetId" = asset."id"
            )
          RETURNING asset."id"
        `);
      return {
        outcome: 'APPLIED',
        rowId: row.id,
        displacedAssetIds: displacedAssetRows.map((asset) => asset.id)
      };
    }, { timeout: 30000 });
  }

  async claimCleanupCandidates(input: CleanupWorkInstructionAssetsInput): Promise<ReadonlyArray<WorkInstructionCleanupCandidate>> {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > 500) return [];
    const activeIds = [...new Set(input.activeAssetIds?.filter(Boolean) ?? [])];
    const activeFilter = activeIds.length > 0
      ? Prisma.sql`AND asset."id" NOT IN (${Prisma.join(activeIds)})`
      : Prisma.empty;
    const stagedCutoff = new Date(input.now.getTime() - STAGED_ASSET_MAX_AGE_MS);
    return this.db.$transaction(async (tx) => tx.$queryRaw<WorkInstructionCleanupCandidate[]>(Prisma.sql`
      WITH candidates AS (
        SELECT asset."id"
        FROM "WorkInstructionAsset" AS asset
        WHERE (
          (asset."status" = 'STAGED' AND asset."createdAt" <= ${stagedCutoff})
          OR (
            asset."status" = 'DELETE_PENDING'
            AND (asset."deletePendingAt" IS NULL OR asset."deletePendingAt" <= ${input.now})
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "WorkInstructionStep" AS step
          WHERE step."assetId" = asset."id"
        )
        ${activeFilter}
        ORDER BY asset."createdAt" ASC, asset."id" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE "WorkInstructionAsset" AS asset
        SET "status" = 'DELETE_PENDING',
            "deletePendingAt" = COALESCE(asset."deletePendingAt", ${input.now}),
            "updatedAt" = ${input.now}
        FROM candidates
        WHERE asset."id" = candidates."id"
        RETURNING asset."id" AS "assetId", asset."storageKey", asset."status", asset."createdAt", asset."deletePendingAt"
      )
      SELECT "assetId", "storageKey", "status", "createdAt", "deletePendingAt"
      FROM claimed
      ORDER BY "createdAt" ASC, "assetId" ASC
    `));
  }

  async deleteAssetRecords(input: { assetIds: ReadonlyArray<string> }): Promise<number> {
    const ids = [...new Set(input.assetIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const result = await this.db.workInstructionAsset.deleteMany({
      where: {
        id: { in: ids },
        status: 'DELETE_PENDING',
        steps: { none: {} }
      }
    });
    return result.count;
  }

  async readGroup(input: { partNumber: string; shootingTarget: string }): Promise<WorkInstructionGroupView | null> {
    return readWorkInstructionGroup(this.db, input);
  }

  async readGroups(input: WorkInstructionGroupsQuery) {
    return readWorkInstructionGroups(this.db, input);
  }

  async readRows(input: WorkInstructionRowsQuery) {
    return readWorkInstructionRows(this.db, input);
  }

  async readAsset(assetId: string) {
    return readWorkInstructionAsset(this.db, assetId);
  }

  async recordImportMessage(input: RecordWorkInstructionImportMessageInput) {
    return recordWorkInstructionImportMessage(this.db, input);
  }

  async readImportMessage(gmailMessageId: string) {
    return readWorkInstructionImportMessage(this.db, gmailMessageId);
  }

  async readImportMessages(input: WorkInstructionImportMessagesQuery) {
    return readWorkInstructionImportMessages(this.db, input);
  }

  private async lockSource(tx: WorkInstructionDbClient, source: WorkInstructionSource): Promise<void> {
    // PostgreSQL text parameters reject NUL bytes. JSON preserves the exact
    // source tokens while remaining a valid text value for hashtext().
    const key = JSON.stringify([source.system, source.list, source.itemId]);
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(${SOURCE_LOCK_NAMESPACE}::int4, hashtext(${key}::text)::int4)
    `);
  }

  private async lockStagedAssets(tx: WorkInstructionDbClient, ids: ReadonlyArray<string>): Promise<WorkInstructionLockedAsset[]> {
    if (ids.length === 0) return [];
    return tx.$queryRaw<WorkInstructionLockedAsset[]>(Prisma.sql`
      SELECT asset."id", asset."status", asset."sha256"
      FROM "WorkInstructionAsset" AS asset
      WHERE asset."id" IN (${Prisma.join(ids)})
      FOR UPDATE
    `);
  }

  private assertStagedAssets(
    input: ReadonlyArray<WorkInstructionStagedAsset>,
    locked: ReadonlyArray<WorkInstructionLockedAsset>
  ): void {
    const byId = new Map(locked.map((asset) => [asset.id, asset]));
    for (const asset of input) {
      const row = byId.get(asset.assetId);
      if (!row || row.status !== 'STAGED' || row.sha256 !== asset.sha256) {
        throw new Error(`asset ${asset.assetId} is no longer staged`);
      }
    }
  }
}
