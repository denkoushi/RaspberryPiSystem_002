import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionFilterCombobox } from './SelfInspectionFilterCombobox';

const firstOptions = [
  { value: '1001', label: '1001 / 製番 A-01', searchText: '1001 製番 a-01' },
  { value: '1002', label: '1002 / 製番 A-02', searchText: '1002 製番 a-02' }
];

function ControlledCombobox({ onSelect = vi.fn() }: { onSelect?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <SelfInspectionFilterCombobox
      ariaLabel="製造order"
      value={value}
      placeholder="製造order"
      options={firstOptions}
      onChange={setValue}
      onSelect={(next) => {
        setValue(next);
        onSelect(next);
      }}
    />
  );
}

describe('SelfInspectionFilterCombobox', () => {
  it('supports keyboard navigation and selection with accessible listbox roles', () => {
    const onSelect = vi.fn();
    render(<ControlledCombobox onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: '製造order' });

    fireEvent.focus(input);
    expect(screen.getByRole('listbox', { name: '製造orderの候補' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('1002');
    expect(input).toHaveValue('1002');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('freezes the opening-time option snapshot until the dropdown closes', () => {
    const { rerender } = render(
      <SelfInspectionFilterCombobox
        ariaLabel="資源CD"
        value=""
        placeholder="581"
        options={firstOptions}
        onChange={() => undefined}
        onSelect={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '資源CDの候補を表示' }));
    rerender(
      <SelfInspectionFilterCombobox
        ariaLabel="資源CD"
        value=""
        placeholder="581"
        options={[{ value: '9999', label: '9999', searchText: '9999' }]}
        onChange={() => undefined}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByRole('option', { name: '1001 / 製番 A-01' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '9999' })).not.toBeInTheDocument();
  });

  it('closes on Escape and outside pointer interaction', () => {
    render(<ControlledCombobox />);
    const input = screen.getByRole('combobox', { name: '製造order' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.focus(input);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reopens from the keyboard and selects the first or last option', () => {
    const onSelect = vi.fn();
    render(<ControlledCombobox onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: '製造order' });

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('1002');
  });
});
