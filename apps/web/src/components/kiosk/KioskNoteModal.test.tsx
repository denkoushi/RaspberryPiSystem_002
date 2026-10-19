import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskNoteModal } from './KioskNoteModal';

describe('KioskNoteModal', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits once per open, even across renders, and resets on reopen', () => {
    const onCommit = vi.fn();
    const props = { value: 'メモ', onCancel: vi.fn(), onCommit };
    const view = render(<KioskNoteModal {...props} pending={false} isOpen />);
    const save = screen.getByRole('button', { name: '保存' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    view.rerender(<KioskNoteModal {...props} pending={false} isOpen value="更新" />);
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('メモ');
    view.rerender(<KioskNoteModal {...props} pending={false} isOpen={false} />);
    view.rerender(<KioskNoteModal {...props} pending={false} isOpen />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('keeps 保存 usable for callers that do not report pending (modal left open after a failed save)', () => {
    const onCommit = vi.fn();
    render(<KioskNoteModal value="メモ" onCancel={vi.fn()} onCommit={onCommit} isOpen />);
    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('shows busy during a save and allows retry when pending becomes false', () => {
    const onCommit = vi.fn();
    const props = { value: '', onCancel: vi.fn(), onCommit, isOpen: true };
    const view = render(<KioskNoteModal {...props} pending={false} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    view.rerender(<KioskNoteModal {...props} pending />);
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledTimes(1);
    view.rerender(<KioskNoteModal {...props} pending={false} />);
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('extraAction 未指定時は追加ボタンを表示しない', () => {
    render(
      <KioskNoteModal
        isOpen
        value=""
        onCancel={vi.fn()}
        onCommit={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '製番登録' })).not.toBeInTheDocument();
  });

  it('extraAction 指定時は追加ボタンを表示して押下できる', () => {
    const onExtraAction = vi.fn();

    render(
      <KioskNoteModal
        isOpen
        value="既存メモ"
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        extraAction={{
          label: '製番登録',
          onClick: onExtraAction
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '製番登録' }));

    expect(onExtraAction).toHaveBeenCalledTimes(1);
  });

  it('extraAction が disabled のときは押下できない', () => {
    const onExtraAction = vi.fn();

    render(
      <KioskNoteModal
        isOpen
        value=""
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        extraAction={{
          label: '製番登録',
          onClick: onExtraAction,
          disabled: true
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '製番登録' }));

    expect(onExtraAction).not.toHaveBeenCalled();
  });
});
