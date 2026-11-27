import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlanningBoardSendOutPopup } from './PlanningBoardSendOutPopup';

const draw = (lastPosition: { current: { left: number; top: number } | undefined }) => render(
  <PlanningBoardSendOutPopup label="305" resource="305" rows={[]} today={0} chipsByPart={new Map()}
    lastPosition={lastPosition} onPreview={vi.fn()} onFocus={vi.fn()} onClose={vi.fn()} />);

describe('PlanningBoardSendOutPopup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('pulls a window that opens past the right edge back on screen once, even if it still measures as overflowing', () => {
    // The stub never changes, so a re-run on every render would loop until React gives up.
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 900, right: 1500, width: 600, top: 100, bottom: 400, height: 300 } as DOMRect);
    const lastPosition = { current: { left: 900, top: 100 } };
    draw(lastPosition);
    const panel = screen.getByRole('region', { name: '305 ★0' });
    expect(panel.style.left).toBe(`${globalThis.innerWidth - 600}px`);
    expect(panel.style.top).toBe('100px');
    expect(lastPosition.current).toEqual({ left: globalThis.innerWidth - 600, top: 100 });
    expect(measure.mock.calls.length).toBeLessThan(5);
  });

  it('keeps a remembered position that already fits', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 100, right: 700, width: 600, top: 100, bottom: 400, height: 300 } as DOMRect);
    const lastPosition = { current: { left: 100, top: 100 } };
    draw(lastPosition);
    expect(screen.getByRole('region', { name: '305 ★0' }).style.left).toBe('100px');
    expect(lastPosition.current).toEqual({ left: 100, top: 100 });
  });
});
