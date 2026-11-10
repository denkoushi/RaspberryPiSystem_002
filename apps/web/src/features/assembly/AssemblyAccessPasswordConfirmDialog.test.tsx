import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssemblyAccessPasswordConfirmDialog } from './AssemblyAccessPasswordConfirmDialog';

const props = {
  title: 'テンプレートを無効化', note: 'このテンプレートは新しい作業で選べなくなります。',
  summaryRows: [{ label: '機種', value: 'MODEL' }], confirmLabel: '無効化する', busyLabel: '無効化中…',
  busy: false, error: null, onConfirm: vi.fn(), onCancel: vi.fn()
};

describe('AssemblyAccessPasswordConfirmDialog', () => {
  it('requires a password, passes it to confirmation and displays errors', () => {
    const view = render(<AssemblyAccessPasswordConfirmDialog {...props} />);
    const confirm = screen.getByRole('button', { name: '無効化する' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('管理パスワード'), { target: { value: '2520' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalledWith('2520');
    view.rerender(<AssemblyAccessPasswordConfirmDialog {...props} error="操作を完了できませんでした。" busy />);
    expect(screen.getByRole('alert')).toHaveTextContent('操作を完了できませんでした。');
    expect(screen.getByRole('button', { name: '無効化中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  });

  it('resets the password when mounted for another target', () => {
    const view = render(<AssemblyAccessPasswordConfirmDialog key="first" {...props} />);
    fireEvent.change(screen.getByLabelText('管理パスワード'), { target: { value: '2520' } });
    view.rerender(<AssemblyAccessPasswordConfirmDialog key="second" {...props} />);
    expect(screen.getByLabelText('管理パスワード')).toHaveValue('');
    expect(screen.getByRole('button', { name: '無効化する' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(props.onCancel).toHaveBeenCalled();
  });
});
