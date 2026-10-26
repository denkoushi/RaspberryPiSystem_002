import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PartSearchPhoneKeyboard } from '../PartSearchPhoneKeyboard';

describe('PartSearchPhoneKeyboard', () => {
  it('prunes presets, kana, alphanumeric keys and space using the existing hidden-key set', () => {
    const append = vi.fn();
    const preset = vi.fn();
    const backspace = vi.fn();
    render(<PartSearchPhoneKeyboard hiddenKeys={new Set(['脚', 'あ', 'A', '0', ' '])} onAppend={append} onPreset={preset} onBackspace={backspace} />);
    const modes = screen.getByRole('group', { name: '文字種' });
    expect(modes.parentElement).toBe(screen.getByLabelText('定型語'));
    expect(modes.nextElementSibling).toContainElement(screen.getByRole('button', { name: '足', exact: true }));
    expect(modes).toHaveClass('shrink-0');
    const backspaceKey = screen.getByRole('button', { name: '1文字消す' });
    expect(screen.getByLabelText('文字キー').lastElementChild).toBe(backspaceKey);
    expect(backspaceKey).toHaveClass('h-11', 'col-start-7', 'row-start-3');
    fireEvent.click(backspaceKey);
    expect(backspace).toHaveBeenCalledOnce();
    for (const name of ['脚', 'あ', '空白']) expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '足', exact: true }));
    expect(preset).toHaveBeenCalledWith('足');
    fireEvent.click(screen.getByRole('button', { name: 'い', exact: true }));
    expect(append).toHaveBeenCalledWith('い');
    fireEvent.click(screen.getByRole('button', { name: '英数' }));
    for (const name of ['A', '0', '空白']) expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1', exact: true }));
    expect(append).toHaveBeenCalledWith('1');
  });
});
