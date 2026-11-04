import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DScheduleMinutesContext } from '../../productionSchedule/DScheduleMinutesContext';

import { dateToDay } from './planningBoardGanttLayout';
import { PlanningBoardGanttSendOutStars } from './PlanningBoardGanttSendOutStars';

import type { GanttBar } from './planningBoardGanttLayout';

const bar = (fseiban: string) => ({ item: { fseiban } }) as unknown as GanttBar;

describe('PlanningBoardGanttSendOutStars', () => {
  it('places one star per send-out day of the seibans on the row', () => {
    const rows = new Map([
      ['A0000001', { fseiban: 'A0000001', outsourceMarks: [], memo: null, surfaceSendOutDates: [{ date: '2026-11-10', note: null }, { date: '2026-11-12', note: '（ＣＴ以外）' }] }],
      ['B0000002', { fseiban: 'B0000002', outsourceMarks: [], memo: null, surfaceSendOutDates: [{ date: '2026-11-10', note: null }] }]
    ]);
    const start = dateToDay('2026-11-04');
    render(<DScheduleMinutesContext.Provider value={{ dueSource: 'scaw', rows }}>
      <PlanningBoardGanttSendOutStars bars={[bar('A0000001'), bar('A0000001'), bar('B0000002'), bar('C0000003')]} start={start} dayWidth={20} />
    </DScheduleMinutesContext.Provider>);
    const stars = screen.getAllByTestId('planning-gantt-send-out-star');
    expect(stars.map((star) => star.style.left)).toEqual(['120px', '160px']);
  });
});
