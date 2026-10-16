import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanningBoardOrderScan } from './PlanningBoardOrderScan';

function scan(raw: string) {
  act(() => {
    for (const key of raw) fireEvent.keyDown(document.activeElement ?? document.body, { key });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });
  });
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.documentElement.style.zoom = ''; });

describe('PlanningBoardOrderScan', () => {
  it('only receives scans while open and closes with the button, close control, Escape or success', () => {
    vi.useFakeTimers();
    const onScan = vi.fn(() => null);
    render(<PlanningBoardOrderScan onScan={onScan} />);
    const button = screen.getByRole('button', { name: '移動票で製番を探す' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    scan('1234567890');
    expect(onScan).not.toHaveBeenCalled();
    for (const close of ['button', 'close', 'escape']) {
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('読み取り待ち')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveFocus();
      if (close === 'button') fireEvent.click(button);
      else if (close === 'close') fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
      else fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveFocus();
      scan('1234567890');
      expect(onScan).not.toHaveBeenCalled();
    }
    fireEvent.click(button);
    scan('*１２３４５６７８９０*');
    expect(onScan).toHaveBeenCalledWith('1234567890');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    scan('1234567890');
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('keeps listening after invalid or missing orders and supports scanners without Enter', () => {
    vi.useFakeTimers();
    const onScan = vi.fn().mockReturnValueOnce('1234567890 の行はこの画面にありません。').mockReturnValue(null);
    render(<PlanningBoardOrderScan onScan={onScan} />);
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scan('12345');
    expect(screen.getByRole('alert')).toHaveTextContent('製造order番号は数字10桁です（読取値: 12345）。読み直してください。');
    expect(onScan).not.toHaveBeenCalled();
    scan('1234567890');
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('1234567890 の行はこの画面にありません。');
    act(() => {
      for (const key of '0987654321') fireEvent.keyDown(document.activeElement!, { key });
      vi.advanceTimersByTime(120);
    });
    expect(onScan).toHaveBeenLastCalledWith('0987654321');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the anchored popup inside the viewport at 70% zoom, including after an error', () => {
    vi.useFakeTimers();
    const getStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = getStyle(element, pseudo);
      if (element === document.documentElement) style.zoom = '0.7';
      return style;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.tagName === 'BUTTON'
        ? { left: 990, bottom: 760, width: 32, height: 32 }
        : { left: 0, bottom: 0, width: 210, height: 140 }) as DOMRect;
    });
    render(<PlanningBoardOrderScan onScan={() => null} />);
    fireEvent.click(screen.getByRole('button', { name: '移動票で製番を探す' }));
    scan('123');
    const panel = screen.getByRole('dialog', { name: '移動票を読み取る' });
    expect(parseFloat(panel.style.left)).toBeCloseTo((window.innerWidth - 210) / 0.7 - 8);
    expect(parseFloat(panel.style.left) * 0.7 + 210).toBeLessThan(window.innerWidth);
    expect(parseFloat(panel.style.top) * 0.7 + 140).toBeLessThan(window.innerHeight);
  });
});
