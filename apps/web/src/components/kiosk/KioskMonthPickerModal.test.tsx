import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskMonthPickerModal } from './KioskMonthPickerModal';

describe('KioskMonthPickerModal', () => {
  it('前年ボタンで初期候補より前の年へ移動しても選択肢が維持される', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00+09:00'));

    render(
      <KioskMonthPickerModal
        isOpen
        value="2026-04"
        onCancel={vi.fn()}
        onCommit={vi.fn()}
        variant="analytics"
      />
    );

    const previousYearButton = screen.getByRole('button', { name: '前年' });
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(previousYearButton);
    }

    expect(screen.getByRole('option', { name: '2019年' })).toBeInTheDocument();
    expect(screen.getByLabelText('年')).toHaveValue('2019');

    vi.useRealTimers();
  });
});
