import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { PlanningBoardSingleResourcePicker } from './PlanningBoardSingleResourcePicker';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([1, 1.25])('keeps the right-placed panel within a narrow viewport (zoom %s)', zoom => {
  vi.stubGlobal('innerWidth', 360);
  const panelWidth = 328;
  const anchor = document.createElement('button');
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ right: 50, top: 100 } as DOMRect);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.hasAttribute('data-planning-board-popover') ? { width: panelWidth, height: 120 } as DOMRect : original.call(this);
  });
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((...args) => {
    const style = computedStyle(...args);
    if (args[0] === document.documentElement) Object.defineProperty(style, 'zoom', { value: String(zoom), configurable: true });
    return style;
  });
  render(<PlanningBoardSingleResourcePicker anchor={anchor} placement="right" resources={['021', '022']} resourceCd="021" resourceNameMap={{}} onSelect={vi.fn()} onClose={vi.fn()} />);
  const panel = screen.getByRole('group', { name: '1台の資源CD' });
  const left = parseFloat(panel.style.left) * zoom;
  expect(left).toBeGreaterThanOrEqual(8 * zoom);
  expect(left + panelWidth).toBeLessThanOrEqual(window.innerWidth - 8 * zoom);
});
