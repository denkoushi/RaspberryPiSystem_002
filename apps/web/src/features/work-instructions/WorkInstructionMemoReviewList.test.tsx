import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkInstructionMemoReviewList } from './WorkInstructionMemoReviewList';

import type {
  WorkInstructionEditorStepDto,
  WorkInstructionMemoOverrideDto
} from '../../api/domains/work-instruction-overlays';

const steps: WorkInstructionEditorStepDto[] = [{
  stepKey: 'SharePoint:WorkInstructions:101:1',
  sourceVersionId: 'latest-1',
  sourceSystem: 'SharePoint',
  sourceList: 'WorkInstructions',
  sourceItemId: 101,
  step: 1,
  text: '加工面を確認します。',
  imageName: null,
  imageAssetId: null,
  imageUrl: null,
  imageMimeType: null,
  sourceModified: '2026-08-31T00:00:00.000Z',
  contentHash: 'latest-hash',
  memoFingerprint: 'latest-memo-fingerprint',
  overlays: []
}];

const unassigned: WorkInstructionMemoOverrideDto = {
  stepKey: null,
  migratedFromStepKey: 'SharePoint:WorkInstructions:101:3',
  migratedFromStep: 3,
  text: '旧版の未割当メモ',
  migrationState: 'UNASSIGNED'
};

describe('WorkInstructionMemoReviewList', () => {
  it('offers target-step KEEP and USE_SOURCE actions for an unassigned memo', () => {
    const onAssignAndKeep = vi.fn();
    const onUseSource = vi.fn();
    render(
      <WorkInstructionMemoReviewList
        steps={steps}
        overrides={[unassigned]}
        onAssignAndKeep={onAssignAndKeep}
        onUseSource={onUseSource}
      />
    );

    const review = screen.getByTestId('work-instruction-memo-review-list');
    expect(review).toHaveTextContent('旧版の未割当メモ');
    const target = within(review).getByRole('combobox', { name: '未割当メモ1の移植先手順' });
    const keep = within(review).getByRole('button', { name: '選択先へKEEP' });
    expect(keep).toBeDisabled();

    fireEvent.change(target, { target: { value: steps[0]!.stepKey } });
    expect(keep).toBeEnabled();
    fireEvent.click(keep);
    expect(onAssignAndKeep).toHaveBeenCalledWith(unassigned.migratedFromStepKey, steps[0]!.stepKey);

    fireEvent.click(within(review).getByRole('button', { name: '原本を使用' }));
    expect(onUseSource).toHaveBeenCalledWith(unassigned.migratedFromStepKey);
  });

  it('does not offer a target step that already owns an active memo override', () => {
    render(
      <WorkInstructionMemoReviewList
        steps={steps}
        overrides={[
          {
            stepKey: steps[0]!.stepKey,
            sourceStep: 1,
            migratedFromStep: 1,
            text: '既存メモ',
            migrationState: 'MIGRATED'
          },
          unassigned
        ]}
        onAssignAndKeep={vi.fn()}
        onUseSource={vi.fn()}
      />
    );

    const target = screen.getByRole('combobox', { name: '未割当メモ1の移植先手順' });
    expect(within(target).queryByRole('option', { name: /加工面を確認/ })).not.toBeInTheDocument();
  });

  it('does not re-list a USE_SOURCE tombstone as an unassigned memo', () => {
    render(
      <WorkInstructionMemoReviewList
        steps={steps}
        overrides={[{
          ...unassigned,
          action: 'USE_SOURCE',
          sourceStep: null,
          migrationState: 'UNASSIGNED'
        }]}
        onAssignAndKeep={vi.fn()}
        onUseSource={vi.fn()}
      />
    );

    expect(screen.queryByTestId('work-instruction-memo-review-list')).not.toBeInTheDocument();
  });
});
