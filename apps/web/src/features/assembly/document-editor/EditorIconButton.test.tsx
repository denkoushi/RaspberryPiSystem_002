import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorIconButton } from './EditorIconButton';

function pointerDown(button: HTMLElement, pointerType: string) {
  const event = new Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(button, event);
}

describe('EditorIconButton', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['left', 'top'] as const)('has an accessible verb without a browser title (%s)', tipSide => {
    const onClick = vi.fn();
    render(<EditorIconButton label="保存する" icon={<path />} onClick={onClick} tipSide={tipSide} pressed badge={2} target="save" />);
    const button = screen.getByRole('button', { name: '保存する' });
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-kiosk-sop-target', 'save');
    expect(screen.getByText('2')).toBeInTheDocument();
    if (tipSide === 'left') {
      fireEvent.pointerEnter(button);
      expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
      expect(screen.getByRole('tooltip')).toHaveStyle({ position: 'fixed', zIndex: 60 });
    } else expect(screen.getByRole('tooltip')).toHaveClass('[@media(hover:hover)]:group-hover:visible', 'group-focus-visible:visible', 'pointer-events-none');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(['pointerUp', 'pointerLeave', 'pointerCancel'] as const)('shows after 500ms of touch and hides 1200ms after %s', release => {
    const onClick = vi.fn();
    render(<EditorIconButton label="隠す" icon={<path />} onClick={onClick} tipSide="top" />);
    const button = screen.getByRole('button', { name: '隠す' });
    pointerDown(button, 'touch');
    act(() => vi.advanceTimersByTime(499));
    expect(button).not.toHaveAttribute('data-tip');
    act(() => vi.advanceTimersByTime(1));
    expect(button).toHaveAttribute('data-tip', 'true');
    expect(screen.getByRole('tooltip')).toHaveClass('group-data-[tip=true]:visible');
    fireEvent[release](button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1199));
    expect(button).toHaveAttribute('data-tip', 'true');
    act(() => vi.advanceTimersByTime(1));
    expect(button).not.toHaveAttribute('data-tip');
  });

  it('shows a disabled rail tooltip outside overflow and hides it on scroll', () => {
    render(<div style={{ overflow: 'hidden' }}><EditorIconButton label="戻す" icon={<path />} onClick={vi.fn()} tipSide="left" disabled /></div>);
    const button = screen.getByRole('button', { name: '戻す' });
    fireEvent.pointerEnter(button.parentElement!);
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
    expect(screen.getByRole('tooltip')).not.toHaveClass('invisible');
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('supports long press on disabled rail buttons', () => {
    render(<EditorIconButton label="戻す" icon={<path />} onClick={vi.fn()} tipSide="left" disabled />);
    const wrapper = screen.getByRole('button', { name: '戻す' }).parentElement!;
    pointerDown(wrapper, 'touch');
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip').parentElement).toBe(document.body);
    fireEvent.pointerUp(wrapper);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not start a long press for a mouse or a short touch', () => {
    render(<EditorIconButton label="隠す" icon={<path />} onClick={vi.fn()} tipSide="top" />);
    const button = screen.getByRole('button', { name: '隠す' });
    pointerDown(button, 'mouse');
    act(() => vi.advanceTimersByTime(500));
    expect(button).not.toHaveAttribute('data-tip');
    pointerDown(button, 'touch');
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(500));
    expect(button).not.toHaveAttribute('data-tip');
  });

  it('clears both long press timers on unmount', () => {
    const view = render(<EditorIconButton label="隠す" icon={<path />} onClick={vi.fn()} tipSide="top" />);
    const button = screen.getByRole('button', { name: '隠す' });
    pointerDown(button, 'touch');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const next = render(<EditorIconButton label="出す" icon={<path />} onClick={vi.fn()} tipSide="top" />);
    fireEvent.pointerUp(screen.getByRole('button', { name: '出す' }));
    next.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
