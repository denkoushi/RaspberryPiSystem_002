import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('disables busy buttons, announces busy and reserves the spinner space while idle', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button busy onClick={onClick}>保存</Button>);
    const button = screen.getByRole('button', { name: '保存' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('[aria-hidden="true"]')).toHaveClass('animate-spin');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button busy={false} onClick={onClick}>保存</Button>);
    expect(button).toBeEnabled();
    expect(button.querySelector('span')).toHaveClass('invisible');
    expect(button.querySelector('.animate-spin')).toBeNull();
  });

  it('keeps existing children, attributes and disabled behavior without busy', () => {
    const { rerender } = render(<Button>保存</Button>);
    const button = screen.getByRole('button', { name: '保存' });
    expect(button.innerHTML).toBe('保存');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
    rerender(<Button disabled aria-busy="false">保存</Button>);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
});
