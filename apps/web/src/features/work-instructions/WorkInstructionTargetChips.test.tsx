import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkInstructionTargetChips } from './WorkInstructionTargetChips';

describe('WorkInstructionTargetChips', () => {
  it('renders target values as touch-friendly, display-only buttons', () => {
    const onSelect = vi.fn();

    render(<WorkInstructionTargetChips targets={['FRONT', 'REAR']} onSelect={onSelect} />);

    const group = screen.getByRole('group', { name: '撮影対象' });
    expect(group).toHaveClass('flex-nowrap', 'overflow-x-auto');
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['FRONT', 'REAR']);
    expect(screen.getByRole('button', { name: 'FRONT' })).toHaveClass('min-h-11');

    fireEvent.click(screen.getByRole('button', { name: 'REAR' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('REAR');
  });

  it('does not select a target while disabled', () => {
    const onSelect = vi.fn();

    render(<WorkInstructionTargetChips targets={['FRONT']} onSelect={onSelect} disabled />);

    const button = screen.getByRole('button', { name: 'FRONT' });
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders no container when there are no targets', () => {
    render(<WorkInstructionTargetChips targets={[]} onSelect={vi.fn()} />);

    expect(screen.queryByRole('group', { name: '撮影対象' })).not.toBeInTheDocument();
  });

  it('labels learned targets with the scanned-to-canonical mapping', () => {
    render(
      <WorkInstructionTargetChips
        targets={['研削']}
        onSelect={vi.fn()}
        similarMatch={{ scannedPartNumber: 'MH009X', canonicalPartNumber: 'MH001' }}
      />
    );

    const chip = screen.getByRole('button', {
      name: '類似・研削（読取品番 MH009X から正式品番 MH001）'
    });
    expect(chip).toHaveTextContent('類似・研削');
    expect(chip).toHaveAttribute('title', '読取品番 MH009X → 正式品番 MH001');
    expect(chip.className).toContain('amber');
  });
});
