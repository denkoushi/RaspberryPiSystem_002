import { Prisma } from '@prisma/client';

import type {
  WorkInstructionEditAssetView,
  WorkInstructionEditRevisionView,
  WorkInstructionOverlayElement,
} from '../domain/editing.js';
import { stepNumber } from '../domain/editing.js';

const workInstructionOverlayOrderBy: Prisma.WorkInstructionEditOverlayOrderByWithRelationInput[] = [
  { sourceStep: 'asc' },
  { zIndex: 'asc' },
  { createdAt: 'asc' }
];

export const workInstructionEditRevisionInclude = {
  overlays: {
    orderBy: workInstructionOverlayOrderBy,
    include: { editAsset: true }
  }
} as const;

export type WorkInstructionEditRevisionRecord = Prisma.WorkInstructionEditRevisionGetPayload<{
  include: typeof workInstructionEditRevisionInclude;
}>;

export type WorkInstructionEditAssetRecord = Prisma.WorkInstructionEditAssetGetPayload<Prisma.WorkInstructionEditAssetDefaultArgs>;

export function toEditAssetView(asset: WorkInstructionEditAssetRecord): WorkInstructionEditAssetView {
  return {
    id: asset.id,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    status: asset.status,
    origin: asset.origin,
    originSourceVersionId: asset.originSourceVersionId,
    originSourceStep: asset.originSourceStep == null ? null : stepNumber(asset.originSourceStep),
    originBbox: asset.originXRatio == null || asset.originYRatio == null || asset.originWidthRatio == null || asset.originHeightRatio == null
      ? null
      : {
        xRatio: Number(asset.originXRatio),
        yRatio: Number(asset.originYRatio),
        widthRatio: Number(asset.originWidthRatio),
        heightRatio: Number(asset.originHeightRatio)
      },
    ownerRevisionId: asset.ownerRevisionId,
    createdAt: asset.createdAt,
    activatedAt: asset.activatedAt,
    deletePendingAt: asset.deletePendingAt
  };
}

type OverlayRecord = WorkInstructionEditRevisionRecord['overlays'][number];

export function toOverlayView(overlay: OverlayRecord): WorkInstructionOverlayElement {
  const base = {
    id: overlay.id,
    sourceStep: overlay.sourceStep == null ? null : stepNumber(overlay.sourceStep),
    migratedFromStep: stepNumber(overlay.migratedFromStep),
    baseStepFingerprint: overlay.baseStepFingerprint,
    targetStepFingerprint: overlay.targetStepFingerprint,
    migrationState: overlay.migrationState,
    bbox: {
      xRatio: Number(overlay.xRatio),
      yRatio: Number(overlay.yRatio),
      widthRatio: Number(overlay.widthRatio),
      heightRatio: Number(overlay.heightRatio)
    },
    zIndex: overlay.zIndex,
    opacity: Number(overlay.opacity),
    mask: overlay.maskEnabled ? { enabled: true, color: overlay.maskColor ?? '' } : undefined
  };
  if (overlay.kind === 'TEXT') {
    return {
      ...base,
      kind: 'TEXT',
      text: overlay.text ?? '',
      ...(overlay.textStyle == null ? {} : { style: overlay.textStyle as Record<string, unknown> })
    } as WorkInstructionOverlayElement;
  }
  if (overlay.kind === 'IMAGE') {
    return {
      ...base,
      kind: 'IMAGE',
      assetId: overlay.editAssetId ?? '',
      objectFit: (overlay.objectFit ?? 'contain') as 'contain' | 'cover' | 'fill'
    };
  }
  return {
    ...base,
    kind: 'SHAPE',
    shape: overlay.shapeKind ?? 'RECTANGLE',
    strokeColor: overlay.strokeColor ?? undefined,
    fillColor: overlay.fillColor ?? undefined,
    strokeWidthRatio: overlay.strokeWidthRatio == null ? undefined : Number(overlay.strokeWidthRatio),
    start: overlay.shapeStartXRatio == null || overlay.shapeStartYRatio == null
      ? undefined
      : { xRatio: Number(overlay.shapeStartXRatio), yRatio: Number(overlay.shapeStartYRatio) },
    end: overlay.shapeEndXRatio == null || overlay.shapeEndYRatio == null
      ? undefined
      : { xRatio: Number(overlay.shapeEndXRatio), yRatio: Number(overlay.shapeEndYRatio) }
  };
}

export function toEditRevisionView(record: WorkInstructionEditRevisionRecord): WorkInstructionEditRevisionView {
  const assets = Object.fromEntries(
    record.overlays
      .map((overlay) => overlay.editAsset)
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => [asset.id, toEditAssetView(asset)])
  );
  return {
    id: record.id,
    sourceVersionId: record.sourceVersionId,
    revisionNumber: record.revisionNumber,
    supersedesRevisionId: record.supersedesRevisionId,
    copiedFromRevisionId: record.copiedFromRevisionId,
    isRevisionHead: record.isRevisionHead,
    status: record.status,
    editVersion: record.editVersion,
    baseContentHash: record.baseContentHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    overlays: record.overlays.map(toOverlayView),
    ...(Object.keys(assets).length > 0 ? { assets } : {})
  };
}

export function overlayToCreateData(
  revisionId: string,
  element: WorkInstructionOverlayElement
): Prisma.WorkInstructionEditOverlayCreateManyInput {
  const common = {
    id: element.id,
    revisionId,
    sourceStep: element.sourceStep == null ? null : BigInt(element.sourceStep),
    migratedFromStep: BigInt(element.migratedFromStep),
    baseStepFingerprint: element.baseStepFingerprint,
    targetStepFingerprint: element.targetStepFingerprint,
    migrationState: element.migrationState,
    xRatio: element.bbox.xRatio,
    yRatio: element.bbox.yRatio,
    widthRatio: element.bbox.widthRatio,
    heightRatio: element.bbox.heightRatio,
    zIndex: element.zIndex,
    opacity: element.opacity,
    maskEnabled: element.mask?.enabled ?? false,
    maskColor: element.mask?.color ?? null,
    text: null,
    textStyle: undefined,
    editAssetId: null,
    objectFit: null,
    shapeKind: null,
    strokeColor: null,
    fillColor: null,
    strokeWidthRatio: null,
    shapeStartXRatio: null,
    shapeStartYRatio: null,
    shapeEndXRatio: null,
    shapeEndYRatio: null
  };
  if (element.kind === 'TEXT') {
    return { ...common, kind: 'TEXT', text: element.text, textStyle: element.style as Prisma.InputJsonValue | undefined };
  }
  if (element.kind === 'IMAGE') {
    return { ...common, kind: 'IMAGE', editAssetId: element.assetId, objectFit: element.objectFit };
  }
  return {
    ...common,
    kind: 'SHAPE',
    shapeKind: element.shape,
    strokeColor: element.strokeColor ?? null,
    fillColor: element.fillColor ?? null,
    strokeWidthRatio: element.strokeWidthRatio ?? null,
    shapeStartXRatio: element.start?.xRatio ?? null,
    shapeStartYRatio: element.start?.yRatio ?? null,
    shapeEndXRatio: element.end?.xRatio ?? null,
    shapeEndYRatio: element.end?.yRatio ?? null
  };
}
