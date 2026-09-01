import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('does not rewrite a persisted ID when a map identity needs a collision suffix', () => {
    const map = memoOverridesToMap([
      { id: 'memo-id', stepKey: step.stepKey, text: '割当済み', migrationState: 'MIGRATED' },
      { id: 'memo-id', stepKey: null, migratedFromStepKey: step.stepKey, migratedFromStep: step.step, text: '未割当', migrationState: 'UNASSIGNED' }
    ]);

    expect(map['memo-id#2']).toMatchObject({ id: 'memo-id', stepKey: null, text: '未割当' });
    expect(memoOverridesToArray(map).filter((override) => override.id === 'memo-id')).toHaveLength(2);
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

  it('creates distinct UUID-backed IDs for new memos after a reset and keeps them in the payload', () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('memo-new-1')
      .mockReturnValueOnce('memo-new-2');
    vi.stubGlobal('crypto', { randomUUID });

    const previous = memoOverridesToMap([{
      id: 'memo-old',
      stepKey: step.stepKey,
      text: '以前のメモ',
      migrationState: 'MIGRATED'
    }]);
    const reset = resetWorkInstructionMemo(previous, step);
    expect(memoOverridesToArray(reset)).toEqual([expect.objectContaining({ id: 'memo-old', action: 'USE_SOURCE' })]);

    // A persisted reset returns an empty override set; the next edit is new.
    const first = updateWorkInstructionMemo(memoOverridesToMap([]), step, '新規メモ1');
    const second = updateWorkInstructionMemo(memoOverridesToMap([]), step, '新規メモ2');
    const firstId = Object.values(first)[0]?.id;
    const secondId = Object.values(second)[0]?.id;

    expect(firstId).toBe('memo-new-1');
    expect(secondId).toBe('memo-new-2');
    expect(firstId).not.toBe(step.stepKey);
    expect(firstId).not.toBe(secondId);
    expect(memoOverridesToArray(first)).toEqual([expect.objectContaining({ id: firstId, text: '新規メモ1' })]);
    expect(memoOverridesToArray(second)).toEqual([expect.objectContaining({ id: secondId, text: '新規メモ2' })]);
  });
});
