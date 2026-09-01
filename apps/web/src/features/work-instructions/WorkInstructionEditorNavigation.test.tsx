import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { memoOverridesToMap } from './workInstructionEditorMemo';
import {
  WorkInstructionEditorRowsPane,
  WorkInstructionEditorStepsPane
} from './WorkInstructionEditorNavigation';

import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';
import type { WorkInstructionEditorStepDto, WorkInstructionMemoOverrideDto } from '../../api/domains/work-instruction-overlays';

function makeStep(step: number): WorkInstructionEditorStepDto {
  return {
    stepKey: `sharepoint:work-instructions:1:${step}`,
    sourceVersionId: 'latest-1',
    sourceSystem: 'sharepoint',
    sourceList: 'work-instructions',
    sourceItemId: 1,
    step,
    text: `手順${step}を確認します。`,
    imageName: null,
    imageAssetId: null,
    imageUrl: null,
    imageMimeType: null,
    imageSha256: null,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: `content-${step}`,
    overlays: []
  };
}

function memoOverride(
  id: string,
  stepKey: string | null,
  migrationState: WorkInstructionMemoOverrideDto['migrationState']
): WorkInstructionMemoOverrideDto {
  return {
    id,
    stepKey,
    sourceStep: stepKey ? 1 : null,
    migratedFromStep: 1,
    text: `${id}のmemo`,
    migrationState
  };
}

function controller(overrides: Partial<WorkInstructionEditorController> = {}): WorkInstructionEditorController {
  const step1 = makeStep(1);
  const step2 = makeStep(2);
  const review = memoOverride('memo-review', step1.stepKey, 'NEEDS_REVIEW');
  const resolved = memoOverride('memo-resolved', step2.stepKey, 'MIGRATED');
  const unassigned = memoOverride('memo-unassigned', null, 'UNASSIGNED');
  const row = (rowId: string, draftId: string, memoOverrides: WorkInstructionMemoOverrideDto[]) => ({
    rowId,
    source: { system: 'sharepoint', list: 'work-instructions', itemId: rowId === 'row-1' ? 1 : rowId === 'row-2' ? 2 : 3 },
    published: { id: `published-${rowId}`, revisionNumber: 1, sourceModified: '2026-08-31T00:00:00.000Z', contentHash: 'published', status: 'published', steps: [step1, step2] },
    latest: { id: `latest-${rowId}`, revisionNumber: 2, sourceModified: '2026-08-31T00:00:00.000Z', contentHash: 'latest', status: 'latest', steps: [step1, step2] },
    draft: { id: draftId, sourceVersionId: `latest-${rowId}`, status: 'draft', revisionNumber: 1, editVersion: 0, sourceModified: '2026-08-31T00:00:00.000Z', contentHash: 'latest', steps: [step1, step2], memoOverrides },
    updateAvailable: false
  });
  const row1Review = row('row-1', 'draft-1', [memoOverride('row-1-review', step1.stepKey, 'MIGRATED')]);
  const row2Review = row('row-2', 'draft-2', [memoOverride('row-2-review', step1.stepKey, 'NEEDS_REVIEW')]);
  const row3Unassigned = row('row-3', 'draft-3', [unassigned]);
  const currentOverridesByRevision = {
    'draft-1': memoOverridesToMap([review]),
    'draft-2': memoOverridesToMap([resolved]),
    'draft-3': memoOverridesToMap([unassigned])
  };
  return {
    rows: [row1Review, row2Review, row3Unassigned],
    group: { migration: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 } } },
    selectedRowId: 'row-1',
    selectRow: vi.fn(),
    activeSteps: [step1, step2],
    selectedStepKey: step1.stepKey,
    selectStep: vi.fn(),
    activeMemoOverrides: currentOverridesByRevision['draft-1'],
    activeMemoOverridesArray: [review],
    activeElements: [],
    memoOverridesByRevision: currentOverridesByRevision,
    ...overrides
  } as unknown as WorkInstructionEditorController;
}

describe('WorkInstructionEditorNavigation', () => {
  it('shows only current blocker rows, keeps unassigned out of step indicators, and keeps row selection clickable', () => {
    const current = controller();
    const view = render(<WorkInstructionEditorRowsPane controller={current} />);

    expect(screen.getByTestId('work-instruction-editor-row-memo-review-row-1')).toHaveAccessibleName('メモ要確認（原本行 row-1）');
    expect(screen.queryByTestId('work-instruction-editor-row-memo-review-row-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('work-instruction-editor-row-memo-review-row-3')).toHaveAccessibleName('メモ要確認（原本行 row-3）');

    fireEvent.click(screen.getByRole('button', { name: /item 1/ }));
    expect(current.selectRow).toHaveBeenCalledWith('row-1');

    view.rerender(<WorkInstructionEditorRowsPane controller={controller({
      memoOverridesByRevision: {
        'draft-1': memoOverridesToMap([memoOverride('row-1-review', 'sharepoint:work-instructions:1:1', 'MIGRATED')]),
        'draft-2': memoOverridesToMap([memoOverride('row-2-review', 'sharepoint:work-instructions:1:1', 'NEEDS_REVIEW')]),
        'draft-3': memoOverridesToMap([memoOverride('memo-unassigned', null, 'UNASSIGNED')])
      }
    })} />);
    expect(screen.queryByTestId('work-instruction-editor-row-memo-review-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('work-instruction-editor-row-memo-review-row-2')).toHaveAccessibleName('メモ要確認（原本行 row-2）');
    expect(screen.getByTestId('work-instruction-editor-row-memo-review-row-3')).toHaveAccessibleName('メモ要確認（原本行 row-3）');

    view.rerender(<WorkInstructionEditorRowsPane controller={controller({
      memoOverridesByRevision: {
        'draft-1': memoOverridesToMap([memoOverride('row-1-review', 'sharepoint:work-instructions:1:1', 'MIGRATED')]),
        'draft-2': memoOverridesToMap([memoOverride('row-2-review', 'sharepoint:work-instructions:1:1', 'NEEDS_REVIEW')]),
        'draft-3': memoOverridesToMap([{ ...memoOverride('memo-unassigned', null, 'UNASSIGNED'), action: 'USE_SOURCE' }])
      }
    })} />);
    expect(screen.queryByTestId('work-instruction-editor-row-memo-review-row-3')).not.toBeInTheDocument();
  });

  it('shows review only on the affected step and keeps step selection clickable', () => {
    const review = memoOverride('memo-review', 'sharepoint:work-instructions:1:1', 'NEEDS_REVIEW');
    const unassigned = memoOverride('memo-unassigned', null, 'UNASSIGNED');
    const current = controller({
      activeMemoOverrides: memoOverridesToMap([review, unassigned]),
      activeMemoOverridesArray: [review, unassigned]
    });
    render(<WorkInstructionEditorStepsPane controller={current} />);

    expect(screen.getByTestId('work-instruction-editor-step-memo-review-sharepoint:work-instructions:1:1')).toHaveAccessibleName('メモ要確認（手順 1）');
    expect(screen.queryByTestId('work-instruction-editor-step-memo-review-sharepoint:work-instructions:1:2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /手順 1/ }));
    expect(current.selectStep).toHaveBeenCalledWith('sharepoint:work-instructions:1:1');
  });
});
