import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMutationFeedback } from './useMutationFeedback';

describe('useMutationFeedback', () => {
  it('メモ編集の開始とコミット時に副作用コールバックを呼び、onSettled で閉じる', () => {
    const onCommitNote = vi.fn();
    const onCommitDueDate = vi.fn();
    const { result } = renderHook(() =>
      useMutationFeedback({
        onCommitNote,
        onCommitDueDate
      })
    );

    act(() => {
      result.current.startNoteEdit('row-1', 'old');
    });

    expect(result.current.isNoteModalOpen).toBe(true);
    expect(result.current.editingNoteValue).toBe('old');

    act(() => {
      result.current.commitNote('next note');
    });

    expect(onCommitNote).toHaveBeenCalledTimes(1);
    const payload = onCommitNote.mock.calls[0][0] as {
      rowId: string;
      note: string;
      onSettled: () => void;
    };
    expect(payload.rowId).toBe('row-1');
    expect(payload.note).toBe('next note');

    act(() => {
      payload.onSettled();
    });

    expect(result.current.isNoteModalOpen).toBe(false);
    expect(result.current.editingNoteValue).toBe('');
  });

  it('納期入力を正規化してコミット時に副作用コールバックを呼ぶ', () => {
    const onCommitNote = vi.fn();
    const onCommitDueDate = vi.fn();
    const { result } = renderHook(() =>
      useMutationFeedback({
        onCommitNote,
        onCommitDueDate
      })
    );

    act(() => {
      result.current.openDueDatePicker('row-2', '2026-03-15T09:10:11.000Z');
    });

    expect(result.current.isDueDatePickerOpen).toBe(true);
    expect(result.current.editingDueDateValue).toBe('2026-03-15');

    act(() => {
      result.current.commitDueDate('2026-03-20');
    });

    expect(onCommitDueDate).toHaveBeenCalledTimes(1);
    const payload = onCommitDueDate.mock.calls[0][0] as {
      rowId: string;
      dueDate: string;
      onSettled: () => void;
    };
    expect(payload.rowId).toBe('row-2');
    expect(payload.dueDate).toBe('2026-03-20');

    act(() => {
      payload.onSettled();
    });

    expect(result.current.isDueDatePickerOpen).toBe(false);
    expect(result.current.editingDueDateValue).toBe('');
  });
});
