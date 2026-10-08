import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconActionTooltip } from './IconActionTooltip';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('row icon tooltip', () => {
  it.each(['button', 'link'] as const)('shows a disabled %s tooltip outside overflow and below a top row', kind => {
    render(<MemoryRouter><div data-testid="scroll" style={{ overflow: 'auto' }}>
      <IconActionTooltip label="使用中は削除できません" disabled>
        {kind === 'button' ? <button aria-label="削除" disabled /> : <Link to="/" aria-label="削除" aria-disabled="true" />}
      </IconActionTooltip>
    </div></MemoryRouter>);
    const action = screen.getByLabelText('削除');
    const wrapper = action.parentElement!;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({ top: 8, bottom: 52, left: 1800, width: 44, height: 44 } as DOMRect);
    fireEvent.pointerEnter(wrapper);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('使用中は削除できません');
    expect(tip.parentElement).toBe(document.body);
    expect(tip).toHaveStyle({ position: 'fixed', top: '58px' });
    expect(screen.getByTestId('scroll')).not.toContainElement(tip);
    expect(action).not.toHaveAttribute('title');
    fireEvent.pointerLeave(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows on focus-visible, hides on blur and on scrolling', () => {
    render(<IconActionTooltip label="直す"><button aria-label="直す" /></IconActionTooltip>);
    const button = screen.getByRole('button');
    vi.spyOn(button, 'matches').mockReturnValue(true);
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('直す');
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerEnter(button.parentElement!);
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('supports 500ms touch long press on disabled actions and clears timers on unmount', () => {
    vi.useFakeTimers();
    const view = render(<IconActionTooltip label="使用中は削除できません" disabled><button disabled aria-label="削除" /></IconActionTooltip>);
    const wrapper = screen.getByRole('button').parentElement!;
    const event = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    fireEvent(wrapper, event);
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerUp(wrapper);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent(wrapper, event);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
