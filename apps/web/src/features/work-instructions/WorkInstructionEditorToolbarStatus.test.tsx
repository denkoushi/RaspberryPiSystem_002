import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkInstructionEditorToolbarStatus } from './WorkInstructionEditorToolbarStatus';

import type { WorkInstructionEditorController } from './useWorkInstructionEditorController';

function controller(overrides: Partial<WorkInstructionEditorController> = {}): WorkInstructionEditorController {
  return {
    busy: false,
    isDirty: false,
    conflict: null,
    message: null,
    group: { migration: { needsReview: 0, memo: { needsReview: 0 } } },
    ...overrides
  } as WorkInstructionEditorController;
}

describe('WorkInstructionEditorToolbarStatus', () => {
  it('shows normal controller messages in the toolbar', () => {
    render(<WorkInstructionEditorToolbarStatus controller={controller({ message: 'オーバーレイを保存しました。' })} />);

    expect(screen.getByTestId('work-instruction-editor-toolbar-message')).toHaveTextContent('オーバーレイを保存しました。');
  });

  it('keeps conflict messages out of the normal toolbar status', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({ message: '競合しています。', conflict: { revisionId: 'revision-1', currentEditVersion: 2 } })}
      />
    );

    expect(screen.queryByTestId('work-instruction-editor-toolbar-message')).not.toBeInTheDocument();
  });

  it('includes memo-only NEEDS_REVIEW items in the overall warning count', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 1, migrated: 0, needsReview: 1, unassigned: 0, skipped: 0 } } }
        })}
      />
    );

    expect(screen.getByText('要確認 1')).toBeInTheDocument();
  });

  it('includes memo-only unassigned items in the overall warning count', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 1, migrated: 0, needsReview: 0, unassigned: 1, skipped: 0 } } }
        })}
      />
    );

    expect(screen.getByText('要確認 1')).toBeInTheDocument();
  });
});
