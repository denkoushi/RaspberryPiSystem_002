import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

vi.mock('../../../../api/hooks/machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
afterEach(() => vi.restoreAllMocks());

function props(mode: 'forward' | 'backward', empty = false): PlanningBoardGanttProps {
  const fixture = productionFixture(3, 1);
  const items = fixture.items.filter((_, i) => !empty || i === 0).map((item, i) => ({ ...item,
    originalResourceCd: i === 1 ? '022' : '021', specialDue: null, requiredMinutes: 60, orderPinned: false
  }));
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, items, resources: ['021'], mode });
  for (const group of layout.groups) for (const row of group.rows) {
    row.flagged = true;
    for (const bar of row.bars) bar.tone = 'late';
  }
  return { layout, singleResourceCd: '021+022', scale: 14, dailyHoursByResource: {}, resourceNameMap: {},
    capacityPending: false, capacityError: false, onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(),
    disabled: false, dragDisabled: false, selectedItemIds: new Set(), resourceView: true,
    focusedSeiban: null, onFocusedSeibanChange: vi.fn() };
}

it.each(['forward', 'backward'] as const)('keeps 022 empty with its resource header (%s)', mode => {
  render(<PlanningBoardGanttDisplay {...props(mode, true)} />);
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  expect(upper.getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
  expect(lower.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
  expect(lower.queryAllByTestId(/^planning-gantt-bar-/)).toHaveLength(0);
  expect(lower.getByTestId('planning-single-resource-head')).toHaveTextContent('022');
  expect(within(lower.getByTestId('planning-single-resource-head')).getByRole('group', { name: '022の1日の稼働時間' })).toBeInTheDocument();
});

it.each(['forward', 'backward'] as const)('renders each resource only in its own pane (%s)', mode => {
  render(<PlanningBoardGanttDisplay {...props(mode)} />);
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  expect(upper.getByTestId('planning-gantt-bar-item-0000')).toBeInTheDocument();
  expect(upper.queryByTestId('planning-gantt-bar-item-0001')).not.toBeInTheDocument();
  expect(lower.getByTestId('planning-gantt-bar-item-0001')).toBeInTheDocument();
  expect(lower.queryByTestId('planning-gantt-bar-item-0000')).not.toBeInTheDocument();
});

it.each(['forward', 'backward'] as const)('opens the value sheet only in the clicked pane (%s)', mode => {
  function Board() {
    const [resource, setResource] = useState<string | null>(null);
    return <PlanningBoardGanttDisplay {...props(mode, true)} valueSheetResource={resource}
      onToggleValueSheet={(next) => setResource(current => current === next ? null : next ?? null)} />;
  }
  render(<QueryClientProvider client={new QueryClient()}><Board /></QueryClientProvider>);
  const upper = within(screen.getByRole('region', { name: '021' }));
  const lower = within(screen.getByRole('region', { name: '022' }));
  fireEvent.click(lower.getByRole('button', { name: /品番の値/ }));
  expect(lower.getByRole('region', { name: '品番の値' })).toBeInTheDocument();
  expect(upper.queryByRole('region', { name: '品番の値' })).not.toBeInTheDocument();
  fireEvent.click(upper.getByRole('button', { name: /品番の値/ }));
  expect(upper.getByRole('region', { name: '品番の値' })).toBeInTheDocument();
  expect(lower.queryByRole('region', { name: '品番の値' })).not.toBeInTheDocument();
  fireEvent.click(upper.getByRole('button', { name: /品番の値/ }));
  expect(screen.queryByRole('region', { name: '品番の値' })).not.toBeInTheDocument();
});

it.each(['scrollToNextOverlap', 'scrollToNextLate'] as const)('moves one pane per %s and restarts on layout change', method => {
  const values = props(method === 'scrollToNextLate' ? 'forward' : 'backward');
  const ref = createRef<PlanningBoardGanttHandle>();
  const view = render(<PlanningBoardGanttDisplay {...values} ref={ref} />);
  const upper = within(screen.getByRole('region', { name: '021' })).getByLabelText('ガントの日付と工程');
  const lower = within(screen.getByRole('region', { name: '022' })).getByLabelText('ガントの日付と工程');
  const upperScroll = vi.fn();
  const lowerScroll = vi.fn();
  Object.defineProperty(upper, 'scrollTo', { value: upperScroll, configurable: true });
  Object.defineProperty(lower, 'scrollTo', { value: lowerScroll, configurable: true });
  const resources = ['021', '021', '022', '021'];
  for (const resource of resources) {
    upperScroll.mockClear(); lowerScroll.mockClear();
    act(() => ref.current![method]());
    expect(upperScroll).toHaveBeenCalledTimes(resource === '021' ? 1 : 0);
    expect(lowerScroll).toHaveBeenCalledTimes(resource === '022' ? 1 : 0);
  }
  act(() => ref.current![method]());
  view.rerender(<PlanningBoardGanttDisplay {...values} layout={{ ...values.layout }} ref={ref} />);
  upperScroll.mockClear(); lowerScroll.mockClear();
  act(() => ref.current![method]());
  expect(upperScroll).toHaveBeenCalledTimes(1);
  expect(lowerScroll).not.toHaveBeenCalled();
});
