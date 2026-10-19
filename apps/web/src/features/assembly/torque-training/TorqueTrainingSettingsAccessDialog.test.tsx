import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TorqueTrainingSettingsAccessDialog } from './TorqueTrainingSettingsAccessDialog';

describe('TorqueTrainingSettingsAccessDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts exactly four digits, submits the PIN, and keeps it out of browser storage', async () => {
    const onSubmit = vi.fn();
    const localStorageSetItem = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <TorqueTrainingSettingsAccessDialog
        open
        busy={false}
        error={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    const password = screen.getByLabelText('操作時パスワード');
    await waitFor(() => expect(password).toHaveFocus());
    fireEvent.change(password, { target: { value: '12a345' } });
    expect(password).toHaveValue('1234');
    expect(screen.getByRole('button', { name: '認証する' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '認証する' }));
    expect(onSubmit).toHaveBeenCalledWith('1234');
    expect(localStorageSetItem).not.toHaveBeenCalled();
  });

  it('shows authentication errors and prevents closing while authentication is pending', () => {
    const onCancel = vi.fn();
    render(
      <TorqueTrainingSettingsAccessDialog
        open
        busy
        error="試行回数が多すぎます。しばらく待ってください。"
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('試行回数が多すぎます');
    expect(screen.getByRole('button', { name: '閉じる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '認証中...' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('clears the input when the dialog closes and reopens', () => {
    const view = render(
      <TorqueTrainingSettingsAccessDialog
        open
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const password = screen.getByLabelText('操作時パスワード');
    fireEvent.change(password, { target: { value: '2520' } });
    expect(password).toHaveValue('2520');

    view.rerender(
      <TorqueTrainingSettingsAccessDialog
        open={false}
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    view.rerender(
      <TorqueTrainingSettingsAccessDialog
        open
        busy={false}
        error={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByLabelText('操作時パスワード')).toHaveValue('');
  });
});
