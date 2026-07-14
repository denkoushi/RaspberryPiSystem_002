import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { KioskFilterCombobox } from './KioskFilterCombobox';

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <KioskFilterCombobox
      ariaLabel="型番"
      value={value}
      placeholder="型番"
      options={[{ value: 'FH-20A', label: 'FH-20A' }, { value: 'FH-30B', label: 'FH-30B' }]}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

describe('KioskFilterCombobox', () => {
  it('keeps free input and supports keyboard option selection', () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole('combobox', { name: '型番' });
    fireEvent.change(input, { target: { value: '自由入力' } });
    expect(onValue).toHaveBeenLastCalledWith('自由入力');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValue).toHaveBeenLastCalledWith('FH-20A');
  });

  it('can refresh server-backed candidates while the dropdown remains open', () => {
    const { rerender } = render(
      <KioskFilterCombobox
        ariaLabel="手順書名"
        value=""
        placeholder="手順書名"
        options={[{ value: '旧候補', label: '旧候補' }]}
        optionUpdateMode="live"
        onChange={() => undefined}
      />
    );
    fireEvent.focus(screen.getByRole('combobox', { name: '手順書名' }));
    expect(screen.getByRole('option', { name: '旧候補' })).toBeInTheDocument();

    rerender(
      <KioskFilterCombobox
        ariaLabel="手順書名"
        value=""
        placeholder="手順書名"
        options={[{ value: '新候補', label: '新候補' }]}
        optionUpdateMode="live"
        onChange={() => undefined}
      />
    );
    expect(screen.getByRole('option', { name: '新候補' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '旧候補' })).not.toBeInTheDocument();
  });
});
