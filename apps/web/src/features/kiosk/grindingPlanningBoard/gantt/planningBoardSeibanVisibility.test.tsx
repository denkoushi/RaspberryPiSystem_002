import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { planningBoardSeibansWithVisibleBars } from './usePlanningBoardSeibanShelf';

import type { GanttBar } from './planningBoardGanttLayout';
import type { PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
beforeEach(() => localStorage.clear());

function boardProps(pair: boolean, arrivalFilterEnabled: boolean, mode: 'forward' | 'backward' = 'forward'): PlanningBoardGanttProps {
  const fixture = productionFixture(6, 1);
  const items = fixture.items.map((item, i) => ({ ...item,
    fseiban: ['A', 'B', 'C', 'WAIT', 'A', 'A'][i]!,
    originalResourceCd: ['305', '306', '307', '305', '305', '307'][i]!,
    specialDue: null, originalDueDate: '2026-10-16', effectiveDueDate: null, requiredMinutes: 60, orderPinned: false, arrived: i !== 3 && i !== 4
  }));
  return {
    layout: buildPlanningBoardGanttLayout({ ...fixture.options, items, mode, arrivalFilterEnabled, scale: 14,
      resources: ['305', '306', '307'], today: '2026-10-14', now: new Date('2026-10-14T09:00:00+09:00') }),
    resourceMinutesItems: items, resourceLanes: ['305', '306', '307'], singleResourceCd: pair ? '305+306' : '305',
    scale: 14, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    selectedItemIds: new Set(), resourceView: true, colorBySeiban: true, seibanOrder: ['C', 'B', 'WAIT', 'A'],
    focusedSeiban: null, onFocusedSeibanChange: vi.fn()
  };
}

function Board({ pair, values }: { pair: boolean; values: PlanningBoardGanttProps }) {
  const [focusedSeiban, onFocusedSeibanChange] = useState<string | null>(null);
  const View = pair ? PlanningBoardGanttDisplay : PlanningBoardGanttView;
  return <View {...values} focusedSeiban={focusedSeiban} onFocusedSeibanChange={onFocusedSeibanChange} />;
}

it.each([[false, false], [false, true], [true, false], [true, true]])(
  'limits shelf columns and collapsed chips to visible machine bars (pair=%s, arrival=%s)', (pair, arrival) => {
    const values = boardProps(pair, arrival);
    render(<Board pair={pair} values={values} />);
    const expected = [...(pair ? ['B'] : []), ...(!arrival ? ['WAIT'] : []), 'A'];
    const shelf = within(screen.getByRole('group', { name: '製番の棚' }));
    // Column buttons carry only the seiban as their accessible name.
    const columns = shelf.getAllByRole('button').filter(button => ['A', 'B', 'C', 'WAIT'].includes(button.getAttribute('aria-label') ?? ''));
    expect(columns.map(button => button.getAttribute('aria-label'))).toEqual(expected);
    expect(shelf.queryByRole('button', { name: 'C', exact: true })).toBeNull();
    if (!pair) expect(shelf.queryByRole('button', { name: 'B', exact: true })).toBeNull();
    if (arrival) expect(shelf.queryByRole('button', { name: 'WAIT', exact: true })).toBeNull();
    // The retained column still includes other machines and pending tiles, with unchanged counts.
    expect(shelf.getByRole('button', { name: 'A', exact: true })).toHaveTextContent('2/3');
    expect(shelf.getByTestId('planning-shelf-tile-item-0005')).toHaveTextContent('307');
    expect(shelf.getByTestId('planning-shelf-tile-item-0004')).toBeInTheDocument();
    fireEvent.click(shelf.getByRole('button', { name: 'A', exact: true }));
    expect(screen.getByTestId('planning-gantt-bar-item-0000')).toHaveClass('ring-white');
    fireEvent.click(screen.getByRole('button', { name: '製番の棚を畳む' }));
    const legend = within(screen.getByRole('group', { name: '製番の色分け凡例' }));
    expect(legend.getAllByRole('button').map(button => button.textContent)).toEqual([...expected, 'すべて表示']);
    fireEvent.click(legend.getByRole('button', { name: 'すべて表示' }));
    fireEvent.click(legend.getByRole('button', { name: 'A', exact: true }));
    expect(screen.getByTestId('planning-gantt-bar-item-0000')).toHaveClass('ring-white');
  }
);

it.each([false, true])('clears focus when the last visible bar enters the arrival queue (pair=%s)', pair => {
  const values = boardProps(pair, false);
  const view = render(<Board pair={pair} values={values} />);
  fireEvent.click(within(screen.getByRole('group', { name: '製番の棚' })).getByRole('button', { name: 'WAIT', exact: true }));
  expect(screen.getByTestId('planning-gantt-bar-item-0003')).toHaveClass('ring-white');
  view.rerender(<Board pair={pair} values={boardProps(pair, true)} />);
  expect(screen.queryByTestId('planning-gantt-bar-item-0003')).toBeNull();
  expect(screen.getByTestId('planning-gantt-bar-item-0000').closest('[data-seiban-focus]')).toBeNull();
  expect(screen.getByRole('group', { name: '製番の棚' })).not.toHaveAttribute('data-shelf-focus');
});

it('keeps every drawn machine in backward single-resource selection', () => {
  render(<Board pair={false} values={boardProps(false, false, 'backward')} />);
  const shelf = within(screen.getByRole('group', { name: '製番の棚' }));
  for (const name of ['B', 'C']) expect(shelf.getByRole('button', { name, exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '製番の棚を畳む' }));
  const legend = within(screen.getByRole('group', { name: '製番の色分け凡例' }));
  expect(legend.getAllByRole('button').map(button => button.textContent)).toEqual(['C', 'B', 'WAIT', 'A']);
});

it('excludes test bars and applies the shared machine selection matching', () => {
  const bars = [
    { resource: '305', item: { kind: 'row', fseiban: 'A' } },
    { resource: '306', item: { kind: 'row', fseiban: 'B' } },
    { resource: '307', item: { kind: 'row', fseiban: 'C' } },
    { resource: '305', item: { kind: 'test', fseiban: 'TEST' } }
  ] as GanttBar[];
  expect([...planningBoardSeibansWithVisibleBars(bars, '305')]).toEqual(['A']);
  expect([...planningBoardSeibansWithVisibleBars(bars, '305+306')]).toEqual(['A', 'B']);
});
