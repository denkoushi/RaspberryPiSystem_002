import type {
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionImportMessageView,
  WorkInstructionRowView,
  WorkInstructionSource,
  WorkInstructionStepView,
} from '../../services/work-instructions/domain/types.js';
import type {
  WorkInstructionEditAssetView,
  WorkInstructionEditRevisionContext,
  WorkInstructionEditRevisionView,
  WorkInstructionEditingView,
  WorkInstructionOverlayElement,
  WorkInstructionSourceVersionView
} from '../../services/work-instructions/domain/editing.js';
function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toStepDto(step: WorkInstructionStepView) {
  return {
    id: step.id,
    step: step.step,
    text: step.text,
    imageName: step.imageName,
    imageAssetId: step.imageAssetId,
    imageUrl: step.imageAssetId
      ? `/api/work-instructions/assets/${step.imageAssetId}`
      : null,
    imageMimeType: step.imageMimeType,
    imageSha256: step.imageSha256,
    overlays: step.overlays?.map(toOverlayDto) ?? [],
    overlayAssets: step.overlayAssets ?? {},
  };
}

export function toOverlayDto(overlay: WorkInstructionOverlayElement) {
  return {
    ...overlay,
    sourceStep: overlay.sourceStep,
    migratedFromStep: overlay.migratedFromStep,
  };
}

export function toSourceVersionDto(version: WorkInstructionSourceVersionView) {
  return {
    id: version.id,
    rowId: version.rowId,
    sourceModified: version.sourceModified.toISOString(),
    partNumber: version.partNumber,
    shootingTarget: version.shootingTarget,
    rawManifest: version.rawManifest,
    contentHash: version.contentHash,
    createdAt: version.createdAt.toISOString(),
    steps: version.steps.map((step) => ({
      ...step,
      imageDeletedAt: iso(step.imageDeletedAt),
      imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
    })),
  };
}

export function toEditAssetDto(asset: WorkInstructionEditAssetView) {
  return {
    assetId: asset.id,
    contentType: asset.mimeType,
    byteSize: asset.sizeBytes,
    sha256: asset.sha256,
    origin: asset.origin,
    originSourceVersionId: asset.originSourceVersionId,
    originSourceStep: asset.originSourceStep,
    originBbox: asset.originBbox,
    createdAt: asset.createdAt.toISOString(),
    activatedAt: iso(asset.activatedAt),
    deletePendingAt: iso(asset.deletePendingAt),
    url: `/api/work-instructions/edit-assets/${asset.id}`,
  };
}

export function toEditingViewDto(view: WorkInstructionEditingView) {
  const revisionTarget = (revision: WorkInstructionEditRevisionView) =>
    revision.sourceVersionId === view.latestVersion.id ? view.latestVersion : view.publishedVersion;
  return {
    rowId: view.rowId,
    latestVersion: toSourceVersionDto(view.latestVersion),
    publishedVersion: toSourceVersionDto(view.publishedVersion),
    draftRevision: view.draftRevision ? toEditorRevisionDto(view.draftRevision, toEditorVersionDto(revisionTarget(view.draftRevision), view.source, 'latest', view.draftRevision.revisionNumber), view.source) : null,
    publishedRevision: view.publishedRevision ? toEditorRevisionDto(view.publishedRevision, toEditorVersionDto(revisionTarget(view.publishedRevision), view.source, 'published', view.publishedRevision.revisionNumber), view.source) : null,
  };
}

function editorStepKey(source: WorkInstructionSource, step: number): string {
  return `${source.system}:${source.list}:${source.itemId}:${step}`;
}

function migrationSummary(revision: WorkInstructionEditRevisionView | null) {
  const overlays = revision?.overlays ?? [];
  return {
    total: overlays.length,
    migrated: overlays.filter((overlay) => overlay.migrationState === 'MIGRATED').length,
    needsReview: overlays.filter((overlay) => overlay.migrationState === 'NEEDS_REVIEW').length,
    unassigned: overlays.filter((overlay) => overlay.migrationState === 'UNASSIGNED').length,
    skipped: overlays.filter((overlay) => overlay.migrationState === 'SKIPPED').length
  };
}

function toEditorVersionDto(
  version: WorkInstructionSourceVersionView,
  source: WorkInstructionSource,
  status: 'latest' | 'published' | 'archived',
  revisionNumber: number
) {
  return {
    id: version.id,
    revisionNumber,
    sourceModified: version.sourceModified.toISOString(),
    contentHash: version.contentHash,
    status,
    steps: version.steps.map((step) => ({
      stepKey: editorStepKey(source, step.step),
      sourceVersionId: version.id,
      sourceSystem: source.system,
      sourceList: source.list,
      sourceItemId: source.itemId,
      step: step.step,
      text: step.text,
      imageName: step.imageName,
      imageAssetId: step.imageAssetId,
      imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
      imageMimeType: step.imageMimeType,
      imageSha256: step.imageSha256,
      imageDeletedAt: iso(step.imageDeletedAt),
      imageDeletedBy: step.imageDeletedBy,
      sourceModified: version.sourceModified.toISOString(),
      contentHash: version.contentHash,
      overlays: []
    })),
    images: version.steps.map((step) => ({
      assetId: step.imageAssetId,
      imageName: step.imageName,
      imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
      imageMimeType: step.imageMimeType,
      imageSha256: step.imageSha256,
      deletedAt: iso(step.imageDeletedAt),
      deletedBy: step.imageDeletedBy,
      canDeleteImage: false
    })).filter((image): image is typeof image & { assetId: string } => Boolean(image.assetId))
  };
}

function toEditorHistoryDto(
  version: WorkInstructionSourceVersionView,
  latestVersionId: string,
  publishedVersionId: string,
  revisionNumber: number,
  publishedRevisionId: string | null
) {
  const isLatest = version.id === latestVersionId;
  const isPublished = version.id === publishedVersionId;
  const canDeleteVersionImages = !isLatest && !isPublished;
  const images = version.steps.filter((step) => step.imageName !== null).map((step) => ({
    assetId: step.imageAssetId,
    imageName: step.imageName,
    imageUrl: step.imageAssetId ? `/api/work-instructions/assets/${step.imageAssetId}` : null,
    imageMimeType: step.imageMimeType,
    imageSha256: step.imageSha256,
    deletedAt: iso(step.imageDeletedAt),
    deletedBy: step.imageDeletedBy,
    canDeleteImage: canDeleteVersionImages && Boolean(step.imageAssetId) && !step.imageDeletedAt
  }));
  const deletedSteps = version.steps.filter((step) => step.imageDeletedAt !== null);
  const latestDeletedStep = [...deletedSteps].sort((left, right) =>
    (left.imageDeletedAt?.getTime() ?? 0) - (right.imageDeletedAt?.getTime() ?? 0)
  ).at(-1);
  return {
    id: version.id,
    sourceVersionId: version.id,
    revisionNumber,
    sourceModified: version.sourceModified.toISOString(),
    contentHash: version.contentHash,
    status: isLatest ? 'latest' : isPublished ? 'published' : 'archived',
    isLatest,
    isPublished,
    publishedRevisionId: isPublished ? publishedRevisionId : null,
    imageCount: version.steps.filter((step) => step.imageName !== null).length,
    deletedImageCount: version.steps.filter((step) => Boolean(step.imageDeletedAt)).length,
    eligibleImageCount: images.filter((image) => image.canDeleteImage).length,
    canDeleteImage: images.some((image) => image.canDeleteImage),
    imageDeletedAt: iso(latestDeletedStep?.imageDeletedAt),
    imageDeletedBy: latestDeletedStep?.imageDeletedBy ?? null,
    images
  };
}

function toEditorRevisionDto(
  revision: WorkInstructionEditRevisionView,
  target: ReturnType<typeof toEditorVersionDto>,
  source: WorkInstructionSource
) {
  const overlaysByStep = new Map<number, WorkInstructionOverlayElement[]>();
  for (const overlay of revision.overlays) {
    if (overlay.sourceStep == null) continue;
    const values = overlaysByStep.get(overlay.sourceStep) ?? [];
    values.push({ ...overlay, stepKey: editorStepKey(source, overlay.sourceStep) } as unknown as WorkInstructionOverlayElement);
    overlaysByStep.set(overlay.sourceStep, values);
  }
  return {
    id: revision.id,
    sourceVersionId: revision.sourceVersionId,
    status: revision.status.toLowerCase(),
    revisionNumber: revision.revisionNumber,
    editVersion: revision.editVersion,
    sourceModified: target.sourceModified,
    contentHash: target.contentHash,
    baseContentHash: revision.baseContentHash,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
    steps: target.steps.map((step) => ({ ...step, overlays: overlaysByStep.get(step.step) ?? [] })),
    overlays: revision.overlays,
    assets: Object.fromEntries(Object.entries(revision.assets ?? {}).map(([assetId, asset]) => [assetId, toEditAssetDto(asset)])),
    migration: migrationSummary(revision)
  };
}

/** Canonical editor payload for every revision write response. */
export function toEditRevisionDto(context: WorkInstructionEditRevisionContext) {
  return toEditorRevisionDto(
    context.revision,
    toEditorVersionDto(context.sourceVersion, context.source, 'latest', context.revision.revisionNumber),
    context.source
  );
}

export function toEditorGroupDto(input: {
  partNumber: string;
  shootingTarget: string;
  rows: ReadonlyArray<{
    source: WorkInstructionSource;
    editing: WorkInstructionEditingView;
    sourceVersions?: ReadonlyArray<WorkInstructionSourceVersionView>;
    latestRevisionNumber: number;
    publishedRevisionNumber: number;
  }>;
}) {
  const rows = input.rows.map(({ source, editing, sourceVersions, latestRevisionNumber, publishedRevisionNumber }) => {
    const published = toEditorVersionDto(editing.publishedVersion, source, 'published', publishedRevisionNumber);
    const latest = toEditorVersionDto(editing.latestVersion, source, 'latest', latestRevisionNumber);
    const draft = editing.draftRevision ? toEditorRevisionDto(editing.draftRevision, latest, source) : null;
    const historyVersions = sourceVersions ?? [editing.latestVersion, editing.publishedVersion];
    const history = historyVersions.map((version, index) => toEditorHistoryDto(
      version,
      editing.latestVersion.id,
      editing.publishedVersion.id,
      Math.max(1, historyVersions.length - index),
      editing.publishedRevision?.id ?? null
    ));
    return {
      rowId: editing.rowId,
      source: { ...source, modified: source.modified.toISOString() },
      published,
      latest,
      draft,
      history,
      updateAvailable: editing.latestVersion.id !== editing.publishedVersion.id,
      migration: migrationSummary(draft ? editing.draftRevision : editing.publishedRevision)
    };
  });
  const migration = rows.reduce((total, row) => {
    total.total += row.migration.total;
    total.migrated += row.migration.migrated;
    total.needsReview += row.migration.needsReview;
    total.unassigned += row.migration.unassigned;
    total.skipped += row.migration.skipped;
    return total;
  }, { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 });
  const history = rows.flatMap((row) => row.history.map((item) => ({ ...item, rowId: row.rowId })));
  return { partNumber: input.partNumber, shootingTarget: input.shootingTarget, rows, migration, history };
}

export function toRowDto(row: WorkInstructionRowView) {
  return {
    id: row.id,
    source: {
      system: row.source.system,
      list: row.source.list,
      itemId: row.source.itemId,
      modified: row.source.modified.toISOString(),
    },
    partNumber: row.partNumber,
    shootingTarget: row.shootingTarget,
    contentHash: row.contentHash,
    rawManifest: row.rawManifest,
    steps: row.steps.map(toStepDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toGroupDto(group: WorkInstructionGroupView) {
  return {
    partNumber: group.partNumber,
    shootingTarget: group.shootingTarget,
    rows: group.rows.map(toRowDto),
    updateAvailable: group.updateAvailable ?? false,
    steps: group.steps.map((step) => ({
      ...toStepDto(step),
      rowId: step.rowId,
      source: {
        system: step.source.system,
        list: step.source.list,
        itemId: step.source.itemId,
      },
    })),
  };
}

export function toGroupSummaryDto(group: WorkInstructionGroupSummaryView) {
  return {
    partNumber: group.partNumber,
    shootingTarget: group.shootingTarget,
    rowCount: group.rowCount,
    stepCount: group.stepCount,
    latestModified: group.latestModified.toISOString(),
  };
}

export function toMessageDto(message: WorkInstructionImportMessageView) {
  return {
    id: message.id,
    gmailMessageId: message.gmailMessageId,
    outcome: message.outcome,
    error: message.error,
    nextRetryAt: iso(message.nextRetryAt),
    mailCleanupPending: message.mailCleanupPending,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}
