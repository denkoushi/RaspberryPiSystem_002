import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingDigitTenkey } from './InspectionDrawingDigitTenkey';

describe('InspectionDrawingDigitTenkey compatibility wrapper', () => {
  it('preserves the existing aria label, key sequence, append, and reset behavior', () => {
    const onChange = vi.fn();
    render(<InspectionDrawingDigitTenkey value="30" onChange={onChange} />);

    const group = screen.getByRole('group', { name: '図面名数字テンキー' });
    expect(group.querySelectorAll('button')).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).toHaveBeenCalledWith('307');
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
