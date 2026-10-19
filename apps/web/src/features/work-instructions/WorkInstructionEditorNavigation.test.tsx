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
    operation: null,
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
  it('shows a source segment only for multiple rows and selects its row', () => {
    const current = controller();
    const view = render(<WorkInstructionEditorRowsPane controller={current} />);
    fireEvent.click(screen.getByRole('button', { name: '原本 2' }));
    expect(current.selectRow).toHaveBeenCalledWith('row-2');
    expect(screen.queryByText(/item|移植/)).not.toBeInTheDocument();
    view.rerender(<WorkInstructionEditorRowsPane controller={controller({ rows: current.rows.slice(0, 1) })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('marks the affected step and keeps unassigned memos out of thumbnails', () => {
    const current = controller({ activeMemoOverridesArray: [memoOverride('review', makeStep(1).stepKey, 'NEEDS_REVIEW'), memoOverride('orphan', null, 'UNASSIGNED')] });
    render(<WorkInstructionEditorStepsPane controller={current} />);
    expect(screen.getByTestId(`work-instruction-editor-step-memo-review-${makeStep(1).stepKey}`)).toHaveAccessibleName('要確認（手順 1）');
    expect(screen.queryByTestId(`work-instruction-editor-step-memo-review-${makeStep(2).stepKey}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '手順 2', exact: true }));
    expect(current.selectStep).toHaveBeenCalledWith(makeStep(2).stepKey);
  });

  it('shows numbers without operation or memo text and marks annotation review', () => {
    const step1 = { ...makeStep(1), operation: 'OP-01' };
    const current = controller({ activeSteps: [step1], activeMemoOverridesArray: [], activeElements: [{ id: 'review', stepKey: step1.stepKey, migrationState: 'NEEDS_REVIEW' }] as WorkInstructionEditorController['activeElements'] });
    render(<WorkInstructionEditorStepsPane controller={current} />);
    expect(screen.queryByText('OP-01')).not.toBeInTheDocument();
    expect(screen.queryByText(step1.text)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手順 1' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId(`work-instruction-editor-step-memo-review-${step1.stepKey}`)).toBeInTheDocument();
  });
});
