import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskDatePickerModal } from './KioskDatePickerModal';

describe('KioskDatePickerModal', () => {
  it.each(['今日', '明日', '明後日', 'クリア', '9月12日'])('commits %s only once per open', (name) => {
    const onCommit = vi.fn();
    const props = { value: '2026-09-12', onCancel: vi.fn(), onCommit };
    const view = render(<KioskDatePickerModal {...props} pending={false} isOpen />);
    const button = screen.getByRole('button', { name, exact: true });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    fireEvent.click(screen.getByRole('button', { name: '明日', exact: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    view.rerender(<KioskDatePickerModal {...props} pending={false} isOpen={false} />);
    view.rerender(<KioskDatePickerModal {...props} pending={false} isOpen />);
    fireEvent.click(screen.getByRole('button', { name: '今日', exact: true }));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('disables all date writes while pending and permits retry after completion', () => {
    const onCommit = vi.fn();
    const props = { isOpen: true, value: '2026-09-12', onCancel: vi.fn(), onCommit };
    const view = render(<KioskDatePickerModal {...props} pending={false} />);
    fireEvent.click(screen.getByRole('button', { name: '今日', exact: true }));
    view.rerender(<KioskDatePickerModal {...props} pending />);
    for (const name of ['今日', '明日', '明後日', 'クリア', '9月12日']) {
      const button = screen.getByRole('button', { name, exact: true });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onCommit).toHaveBeenCalledTimes(1);
    view.rerender(<KioskDatePickerModal {...props} pending={false} />);
    fireEvent.click(screen.getByRole('button', { name: '明日', exact: true }));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
