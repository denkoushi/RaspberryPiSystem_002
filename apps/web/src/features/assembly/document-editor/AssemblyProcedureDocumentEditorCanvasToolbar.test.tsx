import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorCanvasToolbar } from './AssemblyProcedureDocumentEditorCanvasToolbar';

import type { AssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

vi.mock('../../../api/hooks/local-llm', () => ({ useLocalLlmAvailability: () => ({ unavailable: false }) }));

function renderToolbar({ workshop = false, revision = false, locked = false, readOnly = false } = {}) {
  const controller = {
    readOnly, busy: false, canSave: true, canPublish: true, canDiscard: true, canUndo: true, canRedo: true,
    document: { status: 'draft', supersedesDocumentId: revision ? 'previous' : null },
    layoutSuggestions: { locked, canSuggest: true, start: vi.fn() },
    save: vi.fn(), navigateBack: vi.fn(), undo: vi.fn(), redo: vi.fn()
  } as unknown as AssemblyProcedureDocumentEditorController;
  const onDelete = vi.fn(), onDiscard = vi.fn();
  render(<AssemblyProcedureDocumentEditorCanvasToolbar controller={controller} workshop={workshop} materialCount={0} materialOpen={false} videoOpen={false} onMaterial={vi.fn()} onVideo={vi.fn()} onPublish={vi.fn()} onDelete={onDelete} onDiscard={onDiscard} voiceInputEnabled={false} onToggleVoiceInput={vi.fn()} />);
  return { controller, onDelete, onDiscard };
}

describe('document editor toolbar navigation', () => {
  it.each([false, true])('keeps return first and destructive action alone at the bottom (revision: %s)', revision => {
    const { controller, onDelete, onDiscard } = renderToolbar({ workshop: revision, revision });
    const rail = screen.getByRole('navigation', { name: 'エディタ操作' });
    const buttons = within(rail).getAllByRole('button');
    const back = screen.getByRole('button', { name: revision ? '工房へ戻る' : '一覧へ戻る' });
    const destructive = screen.getByRole('button', { name: revision ? '改版を破棄する' : '削除する' });
    expect(buttons[0]).toBe(back);
    expect(buttons[1]).toHaveAccessibleName('保存する');
    expect(rail.children[1]).toHaveClass('h-px');
    expect(buttons.at(-1)).toBe(destructive);
    expect(rail.children[rail.children.length - 2]).toHaveClass('flex-1');
    expect(rail.lastElementChild).toContainElement(destructive);
    expect(back).toHaveClass('h-12');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(back);
    expect(controller.navigateBack).toHaveBeenCalledOnce();
    fireEvent.click(destructive);
    expect(revision ? onDiscard : onDelete).toHaveBeenCalledOnce();
    expect(revision ? onDelete : onDiscard).not.toHaveBeenCalled();
  });

  it('preserves navigation locking and readonly mutation guards', () => {
    const { controller, onDelete } = renderToolbar({ locked: true, readOnly: true });
    const back = screen.getByRole('button', { name: '一覧へ戻る' });
    expect(back).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled();
    const destructive = screen.getByRole('button', { name: '削除する' });
    expect(destructive).toBeDisabled();
    fireEvent.click(back);
    fireEvent.click(destructive);
    expect(controller.navigateBack).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
