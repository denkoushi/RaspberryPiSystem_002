import type {
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionImportMessageView,
  WorkInstructionRowView,
  WorkInstructionStepView,
} from '../../services/work-instructions/domain/types.js';

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
  };
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
