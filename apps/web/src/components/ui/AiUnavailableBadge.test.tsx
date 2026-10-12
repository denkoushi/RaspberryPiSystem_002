import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiUnavailableBadge } from './AiUnavailableBadge';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AiUnavailableBadge', () => {
  it.each([false, undefined])('leaves the button unchanged when unavailable is %s', unavailable => {
    const { container } = render(<AiUnavailableBadge unavailable={unavailable}><button className="h-16" title="話す">話す</button></AiUnavailableBadge>);
    expect(container.innerHTML).toBe('<button class="h-16" title="話す">話す</button>');
  });

  it('adds an accessible hint and a 24px overlay without changing button handlers or grid placement', () => {
    const click = vi.fn();
    render(<AiUnavailableBadge unavailable><button className="col-span-2 h-16" onClick={click} aria-describedby="existing">話す</button></AiUnavailableBadge>);
    const button = screen.getByRole('button', { name: '話す' });
    const badge = screen.getByText('!');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveClass('absolute', 'h-6', 'w-6', 'rounded-full', 'bg-[#f6b93b]');
    expect(badge).toHaveStyle({ boxShadow: '0 0 0 2px #161c22' });
    expect(button).toHaveClass('col-span-2', 'h-16', 'relative');
    expect(button.parentElement).toHaveClass('contents');
    expect(button.getAttribute('aria-describedby')).toMatch(/^existing /);
    expect(button).toHaveAccessibleDescription('AI 未起動');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 164, left: 200, width: 160, height: 64 } as DOMRect);
    fireEvent.pointerEnter(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('AI 未起動');
    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '54px' });
    fireEvent.pointerLeave(button);
    vi.spyOn(button, 'matches').mockReturnValue(true);
    fireEvent.focus(button);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
  });

  it('supports long press and preserves a positioned button and ref', () => {
    vi.useFakeTimers();
    const ref = vi.fn();
    render(<AiUnavailableBadge unavailable positioned><button ref={ref} style={{ position: 'fixed', left: 42, top: 80 }}>Hermes</button></AiUnavailableBadge>);
    const button = screen.getByRole('button');
    expect(ref).toHaveBeenCalledWith(button);
    expect(button).not.toHaveClass('relative');
    expect(button).toHaveStyle({ position: 'fixed', left: '42px', top: '80px' });
    const event = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    fireEvent(button, event);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('tooltip')).toHaveTextContent('AI 未起動');
  });
});
