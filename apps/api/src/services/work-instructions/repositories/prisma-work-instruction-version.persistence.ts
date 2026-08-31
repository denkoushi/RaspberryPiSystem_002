import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type {
  WorkInstructionSourceVersionStepLike,
  WorkInstructionSourceVersionStepView,
  WorkInstructionSourceVersionView
} from '../domain/editing.js';
import { stepNumber } from '../domain/editing.js';
import type { WorkInstructionPacket, WorkInstructionStagedAsset } from '../domain/types.js';
import type { WorkInstructionDbClient } from './prisma-work-instruction.persistence.types.js';

export const workInstructionSourceVersionInclude = {
  steps: {
    orderBy: { step: 'asc' as const },
    include: { imageAsset: true }
  }
} as const;

export type WorkInstructionSourceVersionRecord = Prisma.WorkInstructionSourceVersionGetPayload<{
  include: typeof workInstructionSourceVersionInclude;
}>;

type WorkInstructionSourceVersionStepRecord = WorkInstructionSourceVersionRecord['steps'][number];

export function sourceVersionStepLike(step: WorkInstructionSourceVersionStepRecord): WorkInstructionSourceVersionStepLike {
  return {
    step: step.step,
    text: step.text,
    imageName: step.imageName,
    imageSha256: step.imageSha256
  };
}

function toSourceVersionStepView(step: WorkInstructionSourceVersionStepRecord): WorkInstructionSourceVersionStepView {
  return {
    id: step.id,
    step: stepNumber(step.step),
    text: step.text,
    imageName: step.imageName,
    imageAssetId: step.imageAssetId,
    imageStorageKey: step.imageAsset?.storageKey ?? null,
    imageMimeType: step.imageAsset?.mimeType ?? null,
    imageSha256: step.imageSha256 ?? step.imageAsset?.sha256 ?? null,
    imageDeletedAt: step.imageDeletedAt,
    imageDeletedBy: step.imageDeletedBy
  };
}

export function toSourceVersionView(record: WorkInstructionSourceVersionRecord): WorkInstructionSourceVersionView {
  return {
    id: record.id,
    rowId: record.rowId,
    sourceModified: record.sourceModified,
    partNumber: record.partNumber,
    shootingTarget: record.shootingTarget,
    rawManifest: record.rawManifest as WorkInstructionSourceVersionView['rawManifest'],
    contentHash: record.contentHash,
    createdAt: record.createdAt,
    steps: record.steps.map(toSourceVersionStepView)
  };
}

function sourceVersionStepData(input: {
  step: number | bigint;
  text: string;
  imageName: string | null;
  imageAssetId: string | null;
  imageSha256: string | null;
}): Prisma.WorkInstructionSourceVersionStepUncheckedCreateWithoutSourceVersionInput {
  return {
    id: randomUUID(),
    step: BigInt(input.step),
    text: input.text,
    imageName: input.imageName,
    imageAssetId: input.imageAssetId,
    imageSha256: input.imageSha256
  };
}

export function buildSourceVersionStepData(
  packet: WorkInstructionPacket,
  stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>
): Prisma.WorkInstructionSourceVersionStepUncheckedCreateWithoutSourceVersionInput[] {
  const assetsByName = new Map(stagedAssets.map((asset) => [asset.imageName, asset]));
  return packet.steps.map((step) => {
    const asset = step.imageName === null ? null : assetsByName.get(step.imageName) ?? null;
    return sourceVersionStepData({
      step: step.step,
      text: step.text,
      imageName: step.imageName,
      imageAssetId: asset?.assetId ?? null,
      imageSha256: asset?.sha256 ?? step.imageHash ?? null
    });
  });
}

export async function createSourceVersionFromPacket(
  tx: WorkInstructionDbClient,
  input: {
    rowId: string;
    packet: WorkInstructionPacket;
    stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>;
    now: Date;
  }
): Promise<WorkInstructionSourceVersionRecord> {
  return tx.workInstructionSourceVersion.upsert({
    where: {
      rowId_sourceModified_contentHash: {
        rowId: input.rowId,
        sourceModified: input.packet.source.modified,
        contentHash: input.packet.contentHash
      }
    },
    create: {
      rowId: input.rowId,
      sourceModified: input.packet.source.modified,
      partNumber: input.packet.partNumber,
      shootingTarget: input.packet.shootingTarget,
      rawManifest: input.packet.rawManifest as Prisma.InputJsonValue,
      contentHash: input.packet.contentHash,
      createdAt: input.now,
      steps: { create: buildSourceVersionStepData(input.packet, input.stagedAssets) }
    },
    // Source versions are immutable.  The empty update branch makes
    // concurrent re-import/backfill calls idempotent without a P2002 race.
    update: {},
    include: workInstructionSourceVersionInclude
  });
}

export async function createSourceVersionFromCurrentRow(
  tx: WorkInstructionDbClient,
  row: {
    id: string;
    sourceModified: Date;
    partNumber: string | null;
    shootingTarget: string | null;
    rawManifest: Prisma.JsonValue;
    contentHash: string;
    steps: ReadonlyArray<{
      step: bigint;
      text: string;
      imageName: string | null;
      assetId: string | null;
      asset: { sha256: string } | null;
    }>;
  },
  now: Date
): Promise<WorkInstructionSourceVersionRecord> {
  return tx.workInstructionSourceVersion.upsert({
    where: {
      rowId_sourceModified_contentHash: {
        rowId: row.id,
        sourceModified: row.sourceModified,
        contentHash: row.contentHash
      }
    },
    create: {
      rowId: row.id,
      sourceModified: row.sourceModified,
      partNumber: row.partNumber,
      shootingTarget: row.shootingTarget,
      rawManifest: row.rawManifest as Prisma.InputJsonValue,
      contentHash: row.contentHash,
      createdAt: now,
      steps: {
        create: row.steps.map((step) => sourceVersionStepData({
          step: step.step,
          text: step.text,
          imageName: step.imageName,
          imageAssetId: step.assetId,
          imageSha256: step.asset?.sha256 ?? null
        }))
      }
    },
    update: {},
    include: workInstructionSourceVersionInclude
  });
}

export async function ensureWorkInstructionPublicationForRow(
  tx: WorkInstructionDbClient,
  row: {
    id: string;
    sourceModified: Date;
    partNumber: string | null;
    shootingTarget: string | null;
    rawManifest: Prisma.JsonValue;
    contentHash: string;
    steps: ReadonlyArray<{
      step: bigint;
      text: string;
      imageName: string | null;
      assetId: string | null;
      asset: { sha256: string } | null;
    }>;
  },
  now: Date
) {
  const version = await createSourceVersionFromCurrentRow(tx, row, now);
  return tx.workInstructionSourcePublication.upsert({
    where: { rowId: row.id },
    create: {
      rowId: row.id,
      latestVersionId: version.id,
      publishedVersionId: version.id,
      createdAt: now,
      updatedAt: now
    },
    update: {}
  });
}
