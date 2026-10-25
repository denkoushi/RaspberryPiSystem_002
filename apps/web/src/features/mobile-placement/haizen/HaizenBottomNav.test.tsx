import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HaizenBottomNav } from './HaizenBottomNav';

describe('HaizenBottomNav', () => {
  it('renders four tabs and menu in the bottom row, with the primary action one row above', () => {
    const onSelect = vi.fn();
    const onMenu = vi.fn();
    render(<HaizenBottomNav active="verify" onSelect={onSelect} onMenu={onMenu}>
      <button type="button">次を照合</button>
    </HaizenBottomNav>);
    const bottom = screen.getByRole('contentinfo');
    const tablist = within(bottom).getByRole('tablist', { name: '作業' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['照合', '配膳', '購買', '部品']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tabs[1]);
    expect(onSelect).toHaveBeenCalledWith('place');
    fireEvent.click(within(bottom).getByRole('button', { name: 'ほかの画面' }));
    expect(onMenu).toHaveBeenCalledOnce();
    expect(bottom.lastElementChild).toContainElement(tablist);
    expect(bottom.firstElementChild).toContainElement(screen.getByRole('button', { name: '次を照合' }));
  });

  it('keeps the same tab size with or without a primary action', () => {
    const { rerender } = render(<HaizenBottomNav active="place" onSelect={vi.fn()} onMenu={vi.fn()} />);
    const classes = () => [screen.getByRole('tablist').className, ...screen.getAllByRole('tab').map((tab) => tab.className), screen.getByRole('button', { name: 'ほかの画面' }).className];
    const solo = classes();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    rerender(<HaizenBottomNav active="place" onSelect={vi.fn()} onMenu={vi.fn()}><button type="button">置く</button></HaizenBottomNav>);
    expect(classes()).toEqual(solo);
  });
});
