import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { SelfInspectionRegistrationPolicyDialog } from './SelfInspectionRegistrationPolicyDialog';

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return document.body;
    }
  });
});

afterAll(() => {
  if (originalOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', originalOffsetParent);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  }
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        設定を変更
      </button>
      <SelfInspectionRegistrationPolicyDialog
        open={open}
        requireMeasuringInstrumentTag={false}
        password={password}
        pending={false}
        message={null}
        onPasswordChange={setPassword}
        onCancel={() => setOpen(false)}
        onSubmit={vi.fn()}
      />
    </>
  );
}

describe('SelfInspectionRegistrationPolicyDialog', () => {
  it('focuses the password, traps Tab, locks scroll, closes on Escape, and restores focus', async () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: '設定を変更' });

    opener.focus();
    fireEvent.click(opener);

    const password = await screen.findByLabelText('操作時パスワード');
    const submit = screen.getByRole('button', { name: '変更する' });
    await waitFor(() => expect(password).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');

    submit.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(password).toHaveFocus();

    password.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(submit).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not close from Escape or backdrop interaction while submitting', () => {
    const onCancel = vi.fn();
    render(
      <SelfInspectionRegistrationPolicyDialog
        open
        requireMeasuringInstrumentTag={false}
        password="operation-secret"
        pending
        message={null}
        onPasswordChange={vi.fn()}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(dialog);

    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  });
});
