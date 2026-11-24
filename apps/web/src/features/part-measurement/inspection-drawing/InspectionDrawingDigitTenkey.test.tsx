import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingDigitTenkey } from './InspectionDrawingDigitTenkey';

describe('InspectionDrawingDigitTenkey', () => {
  it('shows the entered digits and lays keys out 1-9, 0, backspace, reset', () => {
    const onChange = vi.fn();
    render(<InspectionDrawingDigitTenkey value="30" onChange={onChange} />);

    expect(screen.getByRole('status', { name: '入力した数字' })).toHaveTextContent('30');
    const group = screen.getByRole('group', { name: '図面名数字テンキー' });
    expect(Array.from(group.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫', 'リセット'
    ]);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).toHaveBeenLastCalledWith('307');
    fireEvent.click(screen.getByRole('button', { name: '1文字消す' }));
    expect(onChange).toHaveBeenLastCalledWith('3');
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('disables backspace and reset when nothing is entered', () => {
    render(<InspectionDrawingDigitTenkey value="" onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '1文字消す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled();
  });
});
