import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GANTT_SETUP_HATCH, PlanningBoardUnitBarSections } from './PlanningBoardUnitBarSections';

import type { GanttBar } from './planningBoardGanttLayout';

describe('PlanningBoardUnitBarSections', () => {
  const bar = { setupSegments: [{ start: 0, end: 1 }], opSegments: [
    { start: 1, end: 2, opNo: 10, completed: true }, { start: 2, end: 5, opNo: 20, completed: false }
  ] } as GanttBar;
  it('draws setup hatching before proportional operations and dims only completed operations', () => {
    const { container } = render(<PlanningBoardUnitBarSections bar={bar} start={0} end={5} />);
    const setup = container.querySelector<HTMLElement>('[data-gantt-setup]')!;
    expect(setup.style.left).toBe('0%'); expect(setup.style.width).toBe('20%'); expect(setup.style.background).toBe(GANTT_SETUP_HATCH);
    const done = container.querySelector<HTMLElement>('[data-gantt-op="10"]')!;
    const todo = container.querySelector<HTMLElement>('[data-gantt-op="20"]')!;
    expect(done.style.left).toBe('20%'); expect(done.style.width).toBe('20%');
    expect(done).toHaveClass('bg-slate-600'); expect(done.dataset.ganttOpCompleted).toBe('true');
    expect(todo.style.left).toBe('40%'); expect(todo.style.width).toBe('60%'); expect(todo).not.toHaveClass('bg-slate-600');
  });
  it('clips decorations to the visible segment without repeating setup in later segments', () => {
    const { container } = render(<PlanningBoardUnitBarSections bar={bar} start={3} end={4} />);
    expect(container.querySelector('[data-gantt-setup]')).toBeNull();
    expect(container.querySelector('[data-gantt-op="10"]')).toBeNull();
    const todo = container.querySelector<HTMLElement>('[data-gantt-op="20"]')!;
    expect(todo.style.left).toBe('0%'); expect(todo.style.width).toBe('100%');
  });
});
