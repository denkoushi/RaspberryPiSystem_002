import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HaizenBottomNav } from './HaizenBottomNav';

describe('HaizenBottomNav', () => {
  it('renders four tabs, menu and primary action in the bottom row', () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    render(<HaizenBottomNav active="verify" onSelect={onSelect} onMenu={onMenu}>
      <button type="button">移動票を読む</button>
    </HaizenBottomNav>);
    const bottom = screen.getByRole('contentinfo');
    const tabs = within(bottom).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['照合', '配膳', '購買', '部品']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tabs[1]);
    expect(onSelect).toHaveBeenCalledWith('place');
    fireEvent.click(within(bottom).getByRole('button', { name: 'ほかの画面' }));
    expect(onMenu).toHaveBeenCalledOnce();
    expect(bottom.lastElementChild).toBe(screen.getByRole('button', { name: '移動票を読む' }));
  });

  it('stretches the tabs in solo mode without a primary action', () => {
    render(<HaizenBottomNav active="place" onSelect={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.getByRole('tablist', { name: '作業' })).toHaveClass('flex-1');
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('flex-1', 'text-[17px]');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'ほかの画面' })).toHaveClass('w-11');
  });
});
