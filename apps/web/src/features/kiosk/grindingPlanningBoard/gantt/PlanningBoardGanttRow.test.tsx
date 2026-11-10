import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay } from './planningBoardGanttLayout';
import { PlanningBoardGanttRow } from './PlanningBoardGanttRow';
import { LATE_STAR_BUTTON_HEIGHT, LATE_STAR_GAP } from './planningBoardLateStars';

import type { GanttBar, GanttRow } from './planningBoardGanttLayout';

describe('PlanningBoardGanttRow', () => {
  it.each([0, 1, 3, 8])('allows all %i late seiban buttons to wrap below the truncated machine label', (count) => {
    const start = dateToDay('2026-11-04');
    const seibans = Array.from({ length: count }, (_, index) => `A000000${index}`);
    const bars = seibans.map((fseiban): GanttBar => ({
      item: { itemId: fseiban, fseiban, lslhSurface: true, isCompleted: false } as GanttBar['item'],
      partKey: fseiban, resource: '305', due: '2026-11-12', start, end: start + 1,
      unknown: false, tone: 'planned', overlaps: [], flagged: false
    }));
    const row: GanttRow = { key: '305', label: '機械305', detail: '機械の詳細', bars, flagged: false, connectors: [] };
    const rows = new Map(seibans.map((fseiban) => [fseiban, {
      fseiban, outsourceMarks: [], memo: null, surfaceSendOutDates: [{ date: '2026-11-05', note: null }]
    }]));
    const { container } = render(<DScheduleMinutesContext.Provider value={{ dueSource: 'scaw', rows }}>
      <PlanningBoardGanttRow row={row} start={start} dayWidth={20} width={400} today="2026-11-09"
        selectedItemIds={new Set()} selectedParts={new Set()} resourceView
        disabled={false} dragDisabled={false} onToggleItem={vi.fn()} onDueDrop={vi.fn()} onToggleSeiban={vi.fn()} />
    </DScheduleMinutesContext.Provider>);

    const element = container.firstElementChild as HTMLDivElement;
    expect(element.style.minHeight).toBe('56px');
    expect(element.style.height).toBe('');
    expect(element.style.containIntrinsicSize).toBe(`auto ${Math.max(56, 32 + Math.ceil(count / 5) * LATE_STAR_BUTTON_HEIGHT + Math.max(0, Math.ceil(count / 5) - 1) * LATE_STAR_GAP)}px`);
    expect(screen.getByText(row.label).classList.contains('truncate')).toBe(true);
    expect(screen.getByText(row.detail).classList.contains('truncate')).toBe(true);
    if (count === 0) {
      expect(screen.queryByTestId('planning-gantt-late-star-dates')).toBeNull();
      return;
    }
    const dates = screen.getByTestId('planning-gantt-late-star-dates');
    expect(within(dates).getAllByRole('button')).toHaveLength(count);
    for (const fseiban of seibans) expect(within(dates).getByRole('button', { name: `${fseiban} ★11/5` })).toBeTruthy();
    expect(dates.classList.contains('flex-wrap')).toBe(true);
    expect(dates.closest('.truncate, .overflow-hidden')).toBeNull();
    expect(screen.getByText(row.label).parentElement).toBe(dates.parentElement);
  });
});
