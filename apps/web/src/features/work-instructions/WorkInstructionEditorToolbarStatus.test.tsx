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
    group: { migration: { needsReview: 0 } },
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
});
