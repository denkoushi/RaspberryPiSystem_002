import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { memoOverridesToMap } from './workInstructionEditorMemo';
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

  it('clears the warning immediately when the saved draft resolves its memo review', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 1, migrated: 1, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 1, migrated: 0, needsReview: 1, unassigned: 0, skipped: 0 } } },
          rows: [{ draft: { memoOverrides: [{ stepKey: 'step-1', text: '保持', migrationState: 'MIGRATED' }] } }] as unknown as WorkInstructionEditorController['rows']
        })}
      />
    );

    expect(screen.queryByText(/要確認/)).not.toBeInTheDocument();
  });

  it('retains a warning when another saved draft row still has an unresolved memo', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 2, migrated: 2, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 2, migrated: 1, needsReview: 1, unassigned: 0, skipped: 0 } } },
          rows: [
            { draft: { memoOverrides: [{ stepKey: 'step-1', text: '保持', migrationState: 'MIGRATED' }] } },
            { draft: { memoOverrides: [{ stepKey: 'step-2', text: '未割当', migrationState: 'UNASSIGNED' }] } }
          ] as unknown as WorkInstructionEditorController['rows']
        })}
      />
    );

    expect(screen.getByText('要確認 1')).toBeInTheDocument();
  });

  it('uses current unsaved memo overrides instead of stale row drafts', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 2, migrated: 2, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 2, migrated: 0, needsReview: 2, unassigned: 0, skipped: 0 } } },
          rows: [
            { draft: { id: 'draft-1', memoOverrides: [{ stepKey: 'step-1', text: '古い要確認', migrationState: 'NEEDS_REVIEW' }] } },
            { draft: { id: 'draft-2', memoOverrides: [{ stepKey: 'step-2', text: '古い要確認', migrationState: 'NEEDS_REVIEW' }] } }
          ] as unknown as WorkInstructionEditorController['rows'],
          memoOverridesByRevision: {
            'draft-1': memoOverridesToMap([{ stepKey: 'step-1', text: 'KEEP済み', migrationState: 'MIGRATED' }]),
            'draft-2': memoOverridesToMap([{ stepKey: 'step-2', text: '未解決', migrationState: 'NEEDS_REVIEW' }])
          }
        })}
      />
    );

    expect(screen.getByText('要確認 1')).toBeInTheDocument();
  });

  it('removes a current USE_SOURCE tombstone from the warning count', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 1, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 1, migrated: 0, needsReview: 0, unassigned: 1, skipped: 0 } } },
          rows: [{ draft: { id: 'draft-1', memoOverrides: [{ stepKey: null, text: '未割当', migrationState: 'UNASSIGNED' }] } }] as unknown as WorkInstructionEditorController['rows'],
          memoOverridesByRevision: {
            'draft-1': memoOverridesToMap([{ stepKey: null, text: '', migrationState: 'UNASSIGNED', action: 'USE_SOURCE' }])
          }
        })}
      />
    );

    expect(screen.queryByText(/要確認/)).not.toBeInTheDocument();
  });

  it('clears the overlay warning immediately when the saved draft resolves it', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 1, migrated: 0, needsReview: 1, unassigned: 0, skipped: 0, memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 } } },
          rows: [{ draft: { overlays: [{ migrationState: 'MIGRATED' }] } }] as unknown as WorkInstructionEditorController['rows']
        })}
      />
    );

    expect(screen.queryByText(/要確認/)).not.toBeInTheDocument();
  });

  it('retains an overlay warning when another saved draft row is unresolved', () => {
    render(
      <WorkInstructionEditorToolbarStatus
        controller={controller({
          group: { migration: { total: 2, migrated: 2, needsReview: 0, unassigned: 0, skipped: 0, memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 } } },
          rows: [
            { draft: { overlays: [{ migrationState: 'MIGRATED' }] } },
            { draft: { overlays: [{ migrationState: 'NEEDS_REVIEW' }] } }
          ] as unknown as WorkInstructionEditorController['rows']
        })}
      />
    );

    expect(screen.getByText('要確認 1')).toBeInTheDocument();
  });
});
