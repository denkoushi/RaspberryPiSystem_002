import { createHash, randomUUID } from 'node:crypto';

import type { WorkInstructionJsonValue, WorkInstructionSource } from './types.js';

export const WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

export class WorkInstructionEditingError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'WorkInstructionEditingError';
  }
}

export type WorkInstructionSourceVersionStepLike = {
  step: number | bigint;
  text: string;
  imageName: string | null;
  imageSha256: string | null;
};

export type WorkInstructionOverlayBBox = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type WorkInstructionOverlayTextStyle = {
  fontFamily?: string;
  fontSizeRatio?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  align?: 'start' | 'center' | 'end';
};

export type WorkInstructionOverlayMask = {
  enabled: boolean;
  color: string;
};

export type WorkInstructionOverlayPoint = {
  xRatio: number;
  yRatio: number;
};

export type WorkInstructionOverlayMigrationState = 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED';

/** Memo migration is deliberately independent from image/overlay migration. */
export type WorkInstructionMemoMigrationState = 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED';

export type WorkInstructionMemoOverrideAction = 'AUTO' | 'KEEP' | 'USE_SOURCE';

type WorkInstructionOverlayBase = {
  id: string;
  sourceStep: number | null;
  migratedFromStep: number;
  baseStepFingerprint: string;
  targetStepFingerprint: string | null;
  migrationState: WorkInstructionOverlayMigrationState;
  bbox: WorkInstructionOverlayBBox;
  zIndex: number;
  opacity: number;
  mask?: WorkInstructionOverlayMask;
};

export type WorkInstructionTextOverlay = WorkInstructionOverlayBase & {
  kind: 'TEXT';
  text: string;
  style?: WorkInstructionOverlayTextStyle;
};

export type WorkInstructionImageOverlay = WorkInstructionOverlayBase & {
  kind: 'IMAGE';
  assetId: string;
  objectFit: 'contain' | 'cover' | 'fill';
};

export type WorkInstructionShapeOverlay = WorkInstructionOverlayBase & {
  kind: 'SHAPE';
  shape: 'RECTANGLE' | 'ELLIPSE' | 'LINE' | 'ARROW';
  strokeColor?: string;
  fillColor?: string;
  strokeWidthRatio?: number;
  start?: WorkInstructionOverlayPoint;
  end?: WorkInstructionOverlayPoint;
};

export type WorkInstructionOverlayElement =
  | WorkInstructionTextOverlay
  | WorkInstructionImageOverlay
  | WorkInstructionShapeOverlay;

export type WorkInstructionMemoOverride = {
  id: string;
  sourceStep: number | null;
  migratedFromStep: number;
  baseStepFingerprint: string;
  targetStepFingerprint: string | null;
  migrationState: WorkInstructionMemoMigrationState;
  /** Empty string is an explicit override and must not be treated as absent. */
  text: string;
};

export type WorkInstructionMemoOverrideInput = {
  id?: string;
  sourceStep: number | null;
  migratedFromStep?: number;
  baseStepFingerprint?: string;
  targetStepFingerprint?: string | null;
  /** Used by the API to detect a source change between read and write. */
  expectedTargetStepFingerprint?: string | null;
  migrationState?: WorkInstructionMemoMigrationState;
  action?: WorkInstructionMemoOverrideAction;
  text: string;
};

export type WorkInstructionOverlayElementInput =
  | (Omit<WorkInstructionTextOverlay, 'id' | 'migratedFromStep' | 'baseStepFingerprint' | 'targetStepFingerprint' | 'migrationState'> & {
      id?: string;
      migratedFromStep?: number;
      baseStepFingerprint?: string;
      targetStepFingerprint?: string | null;
      migrationState?: WorkInstructionOverlayMigrationState;
    })
  | (Omit<WorkInstructionImageOverlay, 'id' | 'migratedFromStep' | 'baseStepFingerprint' | 'targetStepFingerprint' | 'migrationState'> & {
      id?: string;
      migratedFromStep?: number;
      baseStepFingerprint?: string;
      targetStepFingerprint?: string | null;
      migrationState?: WorkInstructionOverlayMigrationState;
    })
  | (Omit<WorkInstructionShapeOverlay, 'id' | 'migratedFromStep' | 'baseStepFingerprint' | 'targetStepFingerprint' | 'migrationState'> & {
      id?: string;
      migratedFromStep?: number;
      baseStepFingerprint?: string;
      targetStepFingerprint?: string | null;
      migrationState?: WorkInstructionOverlayMigrationState;
    });

export type WorkInstructionSourceVersionStepView = {
  id: string;
  step: number;
  text: string;
  imageName: string | null;
  imageAssetId: string | null;
  imageStorageKey: string | null;
  imageMimeType: string | null;
  imageSha256: string | null;
  imageDeletedAt: Date | null;
  imageDeletedBy: string | null;
};

export type WorkInstructionSourceVersionView = {
  id: string;
  rowId: string;
  sourceModified: Date;
  partNumber: string | null;
  shootingTarget: string | null;
  rawManifest: WorkInstructionJsonValue;
  contentHash: string;
  createdAt: Date;
  steps: ReadonlyArray<WorkInstructionSourceVersionStepView>;
};

export type WorkInstructionEditAssetView = {
  id: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: 'STAGED' | 'ACTIVE' | 'DELETE_PENDING';
  origin: 'UPLOAD' | 'ROI';
  originSourceVersionId: string | null;
  originSourceStep: number | null;
  originBbox: WorkInstructionOverlayBBox | null;
  ownerRevisionId: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  deletePendingAt: Date | null;
};

export type WorkInstructionEditAssetOriginInput = {
  origin: 'UPLOAD' | 'ROI';
  sourceVersionId?: string;
  sourceStep?: number;
  bbox?: WorkInstructionOverlayBBox;
};

export type WorkInstructionEditRevisionView = {
  id: string;
  sourceVersionId: string;
  revisionNumber: number;
  supersedesRevisionId: string | null;
  copiedFromRevisionId: string | null;
  isRevisionHead: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'DISCARDED';
  editVersion: number;
  baseContentHash: string;
  createdAt: Date;
  updatedAt: Date;
  overlays: ReadonlyArray<WorkInstructionOverlayElement>;
  memoOverrides?: ReadonlyArray<WorkInstructionMemoOverride>;
  assets?: Readonly<Record<string, WorkInstructionEditAssetView>>;
};

/** Revision plus the immutable source context required by the HTTP DTO. */
export type WorkInstructionEditRevisionContext = {
  revision: WorkInstructionEditRevisionView;
  source: WorkInstructionSource;
  sourceVersion: WorkInstructionSourceVersionView;
};

export type WorkInstructionEditingView = {
  rowId: string;
  source: WorkInstructionSource;
  latestVersion: WorkInstructionSourceVersionView;
  publishedVersion: WorkInstructionSourceVersionView;
  draftRevision: WorkInstructionEditRevisionView | null;
  publishedRevision: WorkInstructionEditRevisionView | null;
};

export type WorkInstructionCopyResult = {
  elements: ReadonlyArray<WorkInstructionOverlayElement>;
  copiedCount: number;
  needsReviewCount: number;
  unassignedCount: number;
  skippedCount: number;
  unassignedIds: ReadonlyArray<string>;
  memo?: WorkInstructionMemoCopyResult;
};

export type WorkInstructionMemoCopyResult = {
  overrides: ReadonlyArray<WorkInstructionMemoOverride>;
  copiedCount: number;
  needsReviewCount: number;
  unassignedCount: number;
  skippedCount: number;
  unassignedIds: ReadonlyArray<string>;
};

export function stepNumber(value: number | bigint): number {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('source step exceeds safe integer boundary');
  return result;
}

export function computeWorkInstructionStepFingerprint(step: WorkInstructionSourceVersionStepLike): string {
  const canonical = JSON.stringify({
    step: stepNumber(step.step),
    text: step.text,
    imageName: step.imageName,
    imageSha256: step.imageSha256
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Canonical memo input for migration.  The imported source body is part of the
 * fingerprint; override text is intentionally never passed to this function.
 */
export function normalizeWorkInstructionMemoBody(text: string): string {
  return text.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

export function computeWorkInstructionMemoFingerprint(step: WorkInstructionSourceVersionStepLike): string {
  const canonical = JSON.stringify({
    step: stepNumber(step.step),
    text: normalizeWorkInstructionMemoBody(step.text)
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePoint(point: WorkInstructionOverlayPoint | undefined, label: string): WorkInstructionOverlayPoint | undefined {
  if (!point) return undefined;
  if (!finite(point.xRatio) || !finite(point.yRatio) || point.xRatio < 0 || point.xRatio > 1 || point.yRatio < 0 || point.yRatio > 1) {
    throw new Error(`${label} coordinates must be between 0 and 1`);
  }
  return { xRatio: point.xRatio, yRatio: point.yRatio };
}

function normalizeBBox(bbox: WorkInstructionOverlayBBox): WorkInstructionOverlayBBox {
  if (!finite(bbox.xRatio) || !finite(bbox.yRatio) || !finite(bbox.widthRatio) || !finite(bbox.heightRatio)
    || bbox.xRatio < 0 || bbox.yRatio < 0 || bbox.widthRatio <= 0 || bbox.heightRatio <= 0
    || bbox.xRatio + bbox.widthRatio > 1 || bbox.yRatio + bbox.heightRatio > 1) {
    throw new Error('overlay bbox is outside the source image');
  }
  return { ...bbox };
}

function normalizeMask(mask: WorkInstructionOverlayMask | undefined): WorkInstructionOverlayMask | undefined {
  if (!mask) return undefined;
  const color = mask.color.trim();
  if (mask.enabled && !color) throw new Error('overlay mask color is required');
  if (color.length > 40) throw new Error('overlay mask color is too long');
  return { enabled: mask.enabled, color };
}

function normalizeFingerprint(value: string | undefined, fallback: string): string {
  const fingerprint = value?.trim() || fallback;
  if (!fingerprint || fingerprint.length > 128) throw new Error('overlay base step fingerprint is invalid');
  return fingerprint;
}

export function normalizeWorkInstructionOverlayElement(
  input: WorkInstructionOverlayElementInput,
  fallbackFingerprint: string,
  index = 0
): WorkInstructionOverlayElement {
  const sourceStep = input.sourceStep;
  if (sourceStep !== null && (!Number.isSafeInteger(sourceStep) || sourceStep <= 0)) throw new Error(`overlay ${index + 1} source step is invalid`);
  const migratedFromStep = input.migratedFromStep ?? sourceStep;
  if (!Number.isSafeInteger(migratedFromStep) || migratedFromStep == null || migratedFromStep <= 0) throw new Error(`overlay ${index + 1} original source step is invalid`);
  const id = input.id?.trim() || randomUUID();
  if (id.length > 120) throw new Error(`overlay ${index + 1} id is too long`);
  const bbox = normalizeBBox(input.bbox);
  const zIndex = input.zIndex ?? 0;
  if (!Number.isInteger(zIndex)) throw new Error(`overlay ${index + 1} zIndex is invalid`);
  const opacity = input.opacity ?? 1;
  if (!finite(opacity) || opacity < 0 || opacity > 1) throw new Error(`overlay ${index + 1} opacity is invalid`);
  const migrationState = input.migrationState ?? (sourceStep === null ? 'UNASSIGNED' : 'MIGRATED');
  if (sourceStep === null && migrationState !== 'UNASSIGNED' && migrationState !== 'SKIPPED') {
    throw new Error(`overlay ${index + 1} without a target step must be UNASSIGNED or SKIPPED`);
  }
  if (sourceStep !== null && (migrationState === 'UNASSIGNED' || migrationState === 'SKIPPED')) {
    throw new Error(`overlay ${index + 1} with a target step cannot be ${migrationState}`);
  }
  const targetFingerprint = input.targetStepFingerprint ?? (sourceStep === null ? null : fallbackFingerprint);
  const baseFingerprint = normalizeFingerprint(input.baseStepFingerprint, sourceStep === null ? '' : fallbackFingerprint);
  const base = {
    id,
    sourceStep,
    migratedFromStep,
    baseStepFingerprint: baseFingerprint,
    targetStepFingerprint: targetFingerprint,
    migrationState,
    bbox,
    zIndex,
    opacity,
    mask: normalizeMask(input.mask)
  };
  switch (input.kind) {
    case 'TEXT': {
      const text = input.text.trim();
      if (!text || text.length > 10_000) throw new Error(`overlay ${index + 1} text is invalid`);
      return { ...base, kind: 'TEXT', text, style: input.style };
    }
    case 'IMAGE': {
      const assetId = input.assetId.trim();
      if (!assetId) throw new Error(`overlay ${index + 1} asset is required`);
      const objectFit = input.objectFit ?? 'contain';
      if (!['contain', 'cover', 'fill'].includes(objectFit)) throw new Error(`overlay ${index + 1} objectFit is invalid`);
      return { ...base, kind: 'IMAGE', assetId, objectFit: objectFit as WorkInstructionImageOverlay['objectFit'] };
    }
    case 'SHAPE': {
      const shape = input.shape;
      const start = normalizePoint(input.start, 'shape start');
      const end = normalizePoint(input.end, 'shape end');
      if ((shape === 'LINE' || shape === 'ARROW') && (!start || !end)) throw new Error(`overlay ${index + 1} line points are required`);
      if (input.strokeWidthRatio != null && (!finite(input.strokeWidthRatio) || input.strokeWidthRatio <= 0)) {
        throw new Error(`overlay ${index + 1} stroke width is invalid`);
      }
      return {
        ...base,
        kind: 'SHAPE',
        shape,
        strokeColor: input.strokeColor?.trim() || undefined,
        fillColor: input.fillColor?.trim() || undefined,
        strokeWidthRatio: input.strokeWidthRatio,
        start,
        end
      };
    }
    default:
      throw new Error(`overlay ${index + 1} kind is invalid`);
  }
}

function normalizeMemoFingerprint(value: string | undefined, fallback: string): string {
  const fingerprint = value?.trim() || fallback;
  if (!fingerprint || fingerprint.length > 128) throw new Error('memo base step fingerprint is invalid');
  return fingerprint;
}

export function normalizeWorkInstructionMemoOverride(
  input: WorkInstructionMemoOverrideInput,
  fallbackFingerprint: string,
  index = 0
): WorkInstructionMemoOverride {
  const sourceStep = input.sourceStep;
  if (sourceStep !== null && (!Number.isSafeInteger(sourceStep) || sourceStep <= 0)) {
    throw new Error(`memo ${index + 1} source step is invalid`);
  }
  const migratedFromStep = input.migratedFromStep ?? sourceStep;
  if (migratedFromStep == null || !Number.isSafeInteger(migratedFromStep) || migratedFromStep <= 0) {
    throw new Error(`memo ${index + 1} original source step is invalid`);
  }
  const id = input.id?.trim() || randomUUID();
  if (id.length > 120) throw new Error(`memo ${index + 1} id is too long`);
  if (typeof input.text !== 'string' || input.text.length > 10_000) throw new Error(`memo ${index + 1} text is invalid`);
  const migrationState = input.migrationState ?? (sourceStep === null ? 'UNASSIGNED' : 'MIGRATED');
  if (sourceStep === null && migrationState !== 'UNASSIGNED' && migrationState !== 'SKIPPED') {
    throw new Error(`memo ${index + 1} without a target step must be UNASSIGNED or SKIPPED`);
  }
  if (sourceStep !== null && migrationState === 'UNASSIGNED') {
    throw new Error(`memo ${index + 1} with a target step cannot be ${migrationState}`);
  }
  return {
    id,
    sourceStep,
    migratedFromStep,
    baseStepFingerprint: normalizeMemoFingerprint(input.baseStepFingerprint, sourceStep === null ? '' : fallbackFingerprint),
    targetStepFingerprint: input.targetStepFingerprint ?? (sourceStep === null ? null : fallbackFingerprint),
    migrationState,
    text: input.text
  };
}

export function copyWorkInstructionOverlays(input: {
  sourceSteps: ReadonlyArray<WorkInstructionSourceVersionStepLike>;
  targetSteps: ReadonlyArray<WorkInstructionSourceVersionStepLike>;
  overlays: ReadonlyArray<WorkInstructionOverlayElement>;
}): WorkInstructionCopyResult {
  const targetByStep = new Map(input.targetSteps.map((step) => [stepNumber(step.step), step]));
  const elements: WorkInstructionOverlayElement[] = [];
  const unassignedIds: string[] = [];
  let needsReviewCount = 0;
  let unassignedCount = 0;
  let skippedCount = 0;
  for (const overlay of input.overlays) {
    const originalStep = input.sourceSteps.find((step) => stepNumber(step.step) === overlay.migratedFromStep);
    const target = targetByStep.get(overlay.migratedFromStep);
    const sourceFingerprint = originalStep ? computeWorkInstructionStepFingerprint(originalStep) : overlay.baseStepFingerprint;
    if (!target) {
      const unassigned = { ...overlay, id: randomUUID(), sourceStep: null, migratedFromStep: overlay.migratedFromStep, targetStepFingerprint: null, baseStepFingerprint: sourceFingerprint, migrationState: overlay.migrationState === 'SKIPPED' ? 'SKIPPED' : 'UNASSIGNED' } as WorkInstructionOverlayElement;
      elements.push(unassigned);
      unassignedIds.push(unassigned.id);
      if (unassigned.migrationState === 'SKIPPED') skippedCount += 1;
      else unassignedCount += 1;
      continue;
    }
    const targetFingerprint = computeWorkInstructionStepFingerprint(target);
    const migrationState = overlay.migrationState === 'SKIPPED'
      ? 'SKIPPED'
      : sourceFingerprint === targetFingerprint ? 'MIGRATED' : 'NEEDS_REVIEW';
    elements.push({
      ...overlay,
      id: randomUUID(),
      sourceStep: stepNumber(target.step),
      migratedFromStep: overlay.migratedFromStep,
      baseStepFingerprint: sourceFingerprint,
      targetStepFingerprint: targetFingerprint,
      migrationState
    });
    if (migrationState === 'NEEDS_REVIEW') needsReviewCount += 1;
    if (migrationState === 'SKIPPED') skippedCount += 1;
  }
  return { elements, copiedCount: elements.length, needsReviewCount, unassignedCount, skippedCount, unassignedIds };
}

/** Copy revision-owned memo overrides while comparing only source memo text. */
export function copyWorkInstructionMemoOverrides(input: {
  sourceSteps: ReadonlyArray<WorkInstructionSourceVersionStepLike>;
  targetSteps: ReadonlyArray<WorkInstructionSourceVersionStepLike>;
  overrides: ReadonlyArray<WorkInstructionMemoOverride>;
}): WorkInstructionMemoCopyResult {
  const sourceByStep = new Map(input.sourceSteps.map((step) => [stepNumber(step.step), step]));
  const targetByStep = new Map(input.targetSteps.map((step) => [stepNumber(step.step), step]));
  const overrides: WorkInstructionMemoOverride[] = [];
  const unassignedIds: string[] = [];
  let needsReviewCount = 0;
  let unassignedCount = 0;
  let skippedCount = 0;
  for (const override of input.overrides) {
    const assignmentStep = override.sourceStep ?? override.migratedFromStep;
    const originalStep = sourceByStep.get(assignmentStep);
    const target = targetByStep.get(assignmentStep);
    const baseStepFingerprint = originalStep
      ? computeWorkInstructionMemoFingerprint(originalStep)
      : override.baseStepFingerprint;
    if (!target) {
      const unassigned: WorkInstructionMemoOverride = {
        ...override,
        id: randomUUID(),
        sourceStep: null,
        targetStepFingerprint: null,
        baseStepFingerprint,
        migrationState: override.migrationState === 'SKIPPED' ? 'SKIPPED' : 'UNASSIGNED'
      };
      overrides.push(unassigned);
      unassignedIds.push(unassigned.id);
      if (unassigned.migrationState === 'SKIPPED') skippedCount += 1;
      else unassignedCount += 1;
      continue;
    }
    const targetStepFingerprint = computeWorkInstructionMemoFingerprint(target);
    const migrationState = override.migrationState === 'SKIPPED'
      ? 'SKIPPED'
      : baseStepFingerprint === targetStepFingerprint ? 'MIGRATED' : 'NEEDS_REVIEW';
    overrides.push({
      ...override,
      id: randomUUID(),
      sourceStep: stepNumber(target.step),
      baseStepFingerprint,
      targetStepFingerprint,
      migrationState
    });
    if (migrationState === 'NEEDS_REVIEW') needsReviewCount += 1;
    if (migrationState === 'SKIPPED') skippedCount += 1;
  }
  return { overrides, copiedCount: overrides.length, needsReviewCount, unassignedCount, skippedCount, unassignedIds };
}
