import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { estimateLateStarLabelHeight, PlanningBoardLateStarDates } from './planningBoardLateStars';

const groups = (count: number, dates = ['2026-11-05']) => Array.from({ length: count }, (_, i) => ({ seibans: [{ fseiban: String(i) }], dates }));

describe('estimateLateStarLabelHeight', () => {
  it('counts the label lines without stars', () => {
    expect(estimateLateStarLabelHeight([], 304, true)).toBe(32);
  });

  it('fits three short date groups on one button line', () => {
    expect(estimateLateStarLabelHeight(groups(3), 304, true)).toBe(60);
  });

  it('wraps buttons and accounts for gaps between lines', () => {
    expect(estimateLateStarLabelHeight(groups(8), 304, true)).toBe(92);
    expect(estimateLateStarLabelHeight(groups(3), 96, true)).toBe(124);
  });

  it('uses smaller text and padding for static dates', () => {
    expect(estimateLateStarLabelHeight(groups(8), 304, false)).toBe(68);
    expect(estimateLateStarLabelHeight(groups(3), 100, false)).toBe(68);
  });

  it('uses all dates in a group when estimating its width', () => {
    expect(estimateLateStarLabelHeight(groups(3, ['2026-11-05', '2026-11-06', '2026-11-07']), 304, true)).toBe(92);
  });

  it('places an oversized group on its own line', () => {
    expect(estimateLateStarLabelHeight(groups(2, Array(12).fill('2026-11-05')), 304, true)).toBe(92);
  });
});

describe('PlanningBoardLateStarDates', () => {
  const merged = [{ dates: ['2026-10-12'], seibans: [
    { fseiban: 'A', itemIds: ['a1', 'a2'] },
    { fseiban: 'B', itemIds: ['b1'] }
  ] }];

  it('passes each focused seiban its own starred item IDs, including the final toggle', () => {
    const onToggleSeiban = vi.fn();
    const draw = (focusedSeiban: string | null) => createElement(PlanningBoardLateStarDates, { groups: merged, focusedSeiban, onToggleSeiban });
    const { rerender } = render(draw(null));
    const button = () => screen.getByRole('button', { name: 'A B ★10/12' });
    for (const [focused, expected, ids] of [
      [null, 'A', ['a1', 'a2']], ['OTHER', 'A', ['a1', 'a2']], ['A', 'B', ['b1']], ['B', 'B', ['b1']]
    ] as const) {
      rerender(draw(focused));
      fireEvent.click(button());
      expect(onToggleSeiban).toHaveBeenLastCalledWith(expected, ids);
    }
  });

  it('renders one static badge and estimates one line for a merged group', () => {
    render(createElement(PlanningBoardLateStarDates, { groups: merged }));
    const dates = screen.getByTestId('planning-gantt-late-star-dates');
    expect(dates.children).toHaveLength(1);
    expect(dates.firstElementChild?.tagName).toBe('SPAN');
    expect(dates).toHaveTextContent('★10/12');
    expect(estimateLateStarLabelHeight(merged, 60, false)).toBe(48);
    expect(estimateLateStarLabelHeight(merged, 60, true)).toBe(60);
  });
});
