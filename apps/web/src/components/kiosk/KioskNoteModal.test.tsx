import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KioskNoteModal } from './KioskNoteModal';

describe('KioskNoteModal', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
