import { describe, expect, it } from 'vitest';

import {
  effectiveWorkInstructionMemo,
  keepWorkInstructionMemo,
  memoOverrideNeedsReview,
  memoOverridesToArray,
  memoOverridesToMap,
  resetWorkInstructionMemo,
  updateWorkInstructionMemo,
  workInstructionStepKey
} from './workInstructionEditorMemo';

import type { WorkInstructionEditorStepDto } from '../../api/domains/work-instruction-overlays';

const step: WorkInstructionEditorStepDto = {
  stepKey: 'sharepoint:work-instructions:1:2',
  sourceVersionId: 'source-version-1',
  sourceSystem: 'sharepoint',
  sourceList: 'work-instructions',
  sourceItemId: 1,
  step: 2,
  text: '原本のメモ',
  effectiveMemo: 'サーバー側のメモ',
  imageName: null,
  imageAssetId: null,
  imageUrl: null,
  imageMimeType: null,
  sourceModified: '2026-08-31T00:00:00.000Z',
  contentHash: 'target-fingerprint',
  overlays: []
};

describe('work instruction editor memo state', () => {
  it('represents an empty string as an active override and reset as row deletion', () => {
    const overrides = updateWorkInstructionMemo({}, step, '');
    const key = workInstructionStepKey(step);

    expect(overrides[key]).toMatchObject({ stepKey: key, text: '', action: 'AUTO' });
    expect(memoOverridesToArray(overrides)).toEqual([expect.objectContaining({ stepKey: key, text: '', action: 'AUTO' })]);
    expect(effectiveWorkInstructionMemo(step, overrides)).toBe('');
    const reset = resetWorkInstructionMemo(overrides, step);
    expect(reset[key]).toMatchObject({ text: '', action: 'USE_SOURCE' });
    expect(effectiveWorkInstructionMemo(step, reset)).toBe('原本のメモ');
  });

  it('preserves a review override until keep records the current target fingerprint', () => {
    const review = memoOverridesToMap([{
      stepKey: step.stepKey,
      text: '旧メモを維持',
      migrationState: 'NEEDS_REVIEW',
      targetStepFingerprint: 'old-target'
    }]);

    expect(memoOverrideNeedsReview(review[step.stepKey])).toBe(true);
    const kept = keepWorkInstructionMemo(review, step);
    expect(kept[step.stepKey]).toMatchObject({
      text: '旧メモを維持',
      targetStepFingerprint: 'old-target',
      expectedTargetStepFingerprint: 'old-target',
      action: 'KEEP',
      migrationState: 'MIGRATED'
    });
    expect(memoOverrideNeedsReview(kept[step.stepKey])).toBe(false);
  });

  it('normalizes alias maps while preserving empty memo values', () => {
    const map = memoOverridesToMap({
      [step.stepKey]: { text: '', migrationState: 'migrated' }
    });

    expect(map[step.stepKey]).toMatchObject({ stepKey: step.stepKey, text: '', migrationState: 'MIGRATED' });
  });

  it('keeps a legacy record step key when its stable ID is the map identity', () => {
    const map = memoOverridesToMap({
      [step.stepKey]: { id: 'memo-id', text: 'legacy memo', migrationState: 'migrated' }
    });

    expect(map).toEqual({
      'memo-id': expect.objectContaining({ id: 'memo-id', stepKey: step.stepKey, text: 'legacy memo' })
    });
    expect(memoOverridesToArray(map)).toEqual([expect.objectContaining({
      id: 'memo-id',
      stepKey: step.stepKey,
      text: 'legacy memo'
    })]);
  });

  it('keeps an unassigned override keyed by its original-step alias', () => {
    const unassigned = memoOverridesToMap([{
      stepKey: null,
      migratedFromStepKey: 'sharepoint:work-instructions:1:4',
      migratedFromStep: 4,
      text: '未割当メモ',
      migrationState: 'UNASSIGNED'
    }]);

    expect(unassigned['sharepoint:work-instructions:1:4']).toMatchObject({
      stepKey: null,
      migratedFromStepKey: 'sharepoint:work-instructions:1:4',
      text: '未割当メモ'
    });
    expect(memoOverridesToArray(unassigned)).toEqual([expect.objectContaining({
      stepKey: null,
      migratedFromStepKey: 'sharepoint:work-instructions:1:4',
      text: '未割当メモ'
    })]);
  });

  it('keeps assigned and unassigned overrides with the same lineage in the full memo set', () => {
    const lineage = step.stepKey;
    const map = memoOverridesToMap([
      {
        id: 'memo-assigned',
        stepKey: lineage,
        text: '割当済みメモ',
        migrationState: 'MIGRATED'
      },
      {
        id: 'memo-unassigned',
        stepKey: null,
        migratedFromStepKey: lineage,
        migratedFromStep: step.step,
        text: '未割当メモ',
        migrationState: 'UNASSIGNED'
      }
    ]);

    expect(Object.keys(map)).toEqual(['memo-assigned', 'memo-unassigned']);
    expect(effectiveWorkInstructionMemo(step, map)).toBe('割当済みメモ');
    expect(memoOverridesToArray(map)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'memo-assigned', stepKey: lineage, text: '割当済みメモ' }),
      expect.objectContaining({ id: 'memo-unassigned', stepKey: null, migratedFromStepKey: lineage, text: '未割当メモ' })
    ]));
  });
});
