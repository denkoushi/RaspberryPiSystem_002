import { describe, expect, it } from 'vitest';

import {
  computeWorkInstructionMemoFingerprint,
  computeWorkInstructionStepFingerprint,
  copyWorkInstructionMemoOverrides,
  copyWorkInstructionOverlays,
  normalizeWorkInstructionMemoOverride,
  normalizeWorkInstructionOverlayElement,
  type WorkInstructionOverlayElement
} from '../editing.js';

const sourceSteps = [
  { step: 1, text: '締結を確認', imageName: 'step-1.jpg', imageSha256: 'a'.repeat(64) },
  { step: 2, text: '記録を保存', imageName: null, imageSha256: null }
];

function textOverlay(step: number, text: string, state?: WorkInstructionOverlayElement['migrationState']): WorkInstructionOverlayElement {
  const fingerprint = computeWorkInstructionStepFingerprint(sourceSteps[step - 1]!);
  return normalizeWorkInstructionOverlayElement({
    kind: 'TEXT',
    sourceStep: step,
    migratedFromStep: step,
    bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
    zIndex: 1,
    opacity: 1,
    text,
    baseStepFingerprint: fingerprint,
    targetStepFingerprint: fingerprint,
    ...(state === undefined ? {} : { migrationState: state })
  }, fingerprint);
}

function memoOverride(step: number, text: string) {
  const fingerprint = computeWorkInstructionMemoFingerprint(sourceSteps[step - 1]!);
  return normalizeWorkInstructionMemoOverride({
    sourceStep: step,
    migratedFromStep: step,
    baseStepFingerprint: fingerprint,
    targetStepFingerprint: fingerprint,
    text
  }, fingerprint);
}

describe('work-instruction overlay copy migration', () => {
  it('copies same-step overlays as MIGRATED when the source fingerprint is unchanged', () => {
    const result = copyWorkInstructionOverlays({
      sourceSteps,
      targetSteps: sourceSteps,
      overlays: [textOverlay(1, '注記')]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 0, unassignedCount: 0 });
    expect(result.elements[0]).toMatchObject({ sourceStep: 1, migratedFromStep: 1, migrationState: 'MIGRATED', text: '注記' });
  });

  it('keeps same-step overlays and marks them NEEDS_REVIEW when the source changed', () => {
    const result = copyWorkInstructionOverlays({
      sourceSteps,
      targetSteps: [{ ...sourceSteps[0]!, text: '締結方法を変更' }, sourceSteps[1]!],
      overlays: [textOverlay(1, '注記')]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 1, unassignedCount: 0 });
    expect(result.elements[0]).toMatchObject({ sourceStep: 1, migratedFromStep: 1, migrationState: 'NEEDS_REVIEW' });
  });

  it('retains an overlay as UNASSIGNED when the target step is absent', () => {
    const result = copyWorkInstructionOverlays({
      sourceSteps,
      targetSteps: [sourceSteps[1]!],
      overlays: [textOverlay(1, '注記')]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 0, unassignedCount: 1 });
    expect(result.unassignedIds).toHaveLength(1);
    expect(result.elements[0]).toMatchObject({ sourceStep: null, migratedFromStep: 1, migrationState: 'UNASSIGNED', text: '注記' });
  });

  it('keeps an already skipped orphan instead of dropping it', () => {
    const skipped = { ...textOverlay(2, '旧注記'), migrationState: 'SKIPPED' as const };
    const result = copyWorkInstructionOverlays({
      sourceSteps,
      targetSteps: [],
      overlays: [skipped]
    });

    expect(result).toMatchObject({ copiedCount: 1, skippedCount: 1, unassignedCount: 0 });
    expect(result.elements[0]).toMatchObject({ sourceStep: null, migratedFromStep: 2, migrationState: 'SKIPPED' });
  });

  it('memo fingerprint includes normalized source text but excludes image changes', () => {
    const first = computeWorkInstructionMemoFingerprint(sourceSteps[0]!);
    expect(computeWorkInstructionMemoFingerprint({ ...sourceSteps[0]!, imageName: 'new.jpg', imageSha256: 'z'.repeat(64) })).toBe(first);
    expect(computeWorkInstructionMemoFingerprint({ ...sourceSteps[0]!, text: '  締結を確認\r\n' })).toBe(first);
    expect(computeWorkInstructionMemoFingerprint({ ...sourceSteps[0]!, text: '締結方法を変更' })).not.toBe(first);
  });

  it('copies memo overrides independently from image migration and preserves empty text', () => {
    const result = copyWorkInstructionMemoOverrides({
      sourceSteps,
      targetSteps: [{ ...sourceSteps[0]!, imageName: 'new.jpg', imageSha256: 'z'.repeat(64) }, sourceSteps[1]!],
      overrides: [memoOverride(1, '')]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 0, unassignedCount: 0 });
    expect(result.overrides[0]).toMatchObject({ sourceStep: 1, migrationState: 'MIGRATED', text: '' });
  });

  it('preserves a manually reassigned memo target on the next source migration', () => {
    const originalFingerprint = computeWorkInstructionMemoFingerprint(sourceSteps[0]!);
    const reassigned = normalizeWorkInstructionMemoOverride({
      sourceStep: 2,
      migratedFromStep: 1,
      baseStepFingerprint: originalFingerprint,
      targetStepFingerprint: computeWorkInstructionMemoFingerprint(sourceSteps[1]!),
      text: '手動再割当'
    }, originalFingerprint);

    const result = copyWorkInstructionMemoOverrides({
      sourceSteps,
      targetSteps: sourceSteps,
      overrides: [reassigned]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 0, unassignedCount: 0 });
    expect(result.overrides[0]).toMatchObject({
      sourceStep: 2,
      migratedFromStep: 1,
      migrationState: 'MIGRATED',
      text: '手動再割当'
    });
  });

  it('marks memo overrides NEEDS_REVIEW when only the source text changes', () => {
    const result = copyWorkInstructionMemoOverrides({
      sourceSteps,
      targetSteps: [{ ...sourceSteps[0]!, text: '締結方法を変更' }, sourceSteps[1]!],
      overrides: [memoOverride(1, '現場memo')]
    });

    expect(result).toMatchObject({ copiedCount: 1, needsReviewCount: 1 });
    expect(result.overrides[0]).toMatchObject({ sourceStep: 1, migrationState: 'NEEDS_REVIEW', text: '現場memo' });
  });
});
