import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { PlanningBoardGanttDisplay } from './PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { buildSingleResourceWindows } from './planningBoardSingleResourceWindows';

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

function elapsedRowProps(scale = 1) {
  const values = props('forward');
  const windows = buildSingleResourceWindows(values.layout.today, values.layout.end, scale, 8);
  const groups = values.layout.groups.map(group => {
    const row = group.rows[0]!;
    const template = row.bars[0]!;
    return { ...group, rows: [{ ...row, bars: ['hidden', 'visible'].map((kind) => {
      const start = windows[0]!.start;
      const end = windows[kind === 'hidden' ? 0 : 1]!.end;
      return { ...template, item: { ...template.item, itemId: `${kind}-${group.resource}` },
        start, end, segments: [{ start, end }], tone: 'late' as const };
    }) }] };
  });
  return { values: { ...values, scale, layout: { ...values.layout, groups, lateCount: 4 } }, windows };
}

it.each([1, 2])('removes elapsed rows in both panes while retaining the row containing now (scale %s)', scale => {
  const { values, windows } = elapsedRowProps(scale);
  const draw = (now: number) => <PlanningBoardGanttDisplay {...values} layout={{ ...values.layout, now }} />;
  const { rerender } = render(draw(windows[0]!.end - 1 / 86400));
  const rows = (resource: string) => [...screen.getByRole('region', { name: resource })
    .querySelectorAll<HTMLElement>('[data-gantt-window-row]')].map(row => row.dataset.ganttWindowRow);
  const before = ['021', '022'].map(rows);
  for (const keys of before) expect(keys[0]).toContain(`:single:${windows[0]!.key}`);

  rerender(draw(windows[0]!.end));
  for (const [index, resource] of ['021', '022'].entries()) {
    expect(rows(resource)).toEqual(before[index]!.slice(1));
    expect(screen.queryByTestId(`planning-gantt-bar-hidden-${resource}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`planning-gantt-bar-visible-${resource}`)).toBeInTheDocument();
  }

  rerender(draw(windows[1]!.end - 1 / 86400));
  for (const resource of ['021', '022']) expect(rows(resource)[0]).toContain(`:single:${windows[1]!.key}`);
  expect(values.layout.lateCount).toBe(4);
});

it('cycles only remaining late bars across both panes and refreshes the targets when time advances', () => {
  const { values, windows } = elapsedRowProps();
  const ref = createRef<PlanningBoardGanttHandle>();
  const draw = (now: number) => <PlanningBoardGanttDisplay {...values} ref={ref} layout={{ ...values.layout, now }} />;
  const { rerender } = render(draw(windows[0]!.end - 1 / 86400));
  const scrolls = ['021', '022'].map(resource => {
    const viewport = within(screen.getByRole('region', { name: resource })).getByLabelText('ガントの日付と工程');
    const scroll = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { value: scroll, configurable: true });
    return scroll;
  });
  act(() => ref.current!.scrollToNextLate());
  expect(scrolls[0]).toHaveBeenCalledTimes(1);
  rerender(draw(windows[0]!.end));
  for (const index of [0, 1, 0, 1, 0]) {
    scrolls.forEach(scroll => scroll.mockClear());
    act(() => ref.current!.scrollToNextLate());
    expect(scrolls[index]).toHaveBeenCalledTimes(1);
    expect(scrolls[1 - index]).not.toHaveBeenCalled();
  }
  rerender(draw(windows[1]!.end));
  scrolls.forEach(scroll => scroll.mockClear());
  act(() => ref.current!.scrollToNextLate());
  act(() => ref.current!.scrollToNextLate());
  scrolls.forEach(scroll => expect(scroll).not.toHaveBeenCalled());
  expect(values.layout.lateCount).toBe(4);
});

it.each(['021', '022'])('does not scroll to a hidden item in %s, but scrolls to its first remaining segment', resource => {
  const { values, windows } = elapsedRowProps();
  const ref = createRef<PlanningBoardGanttHandle>();
  render(<PlanningBoardGanttDisplay {...values} ref={ref} layout={{ ...values.layout, now: windows[0]!.end }} />);
  const pane = screen.getByRole('region', { name: resource });
  const viewport = within(pane).getByLabelText('ガントの日付と工程');
  const scroll = vi.fn();
  Object.defineProperty(viewport, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(viewport, 'scrollTo', { value: scroll, configurable: true });
  const targetRow = within(pane).getByTestId(`planning-gantt-bar-visible-${resource}`).closest('[data-gantt-window-row]')!;
  vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect);
  let moved: boolean | undefined;
  act(() => { moved = ref.current!.scrollToItem(`hidden-${resource}`); });
  expect(moved).toBe(false);
  expect(scroll).not.toHaveBeenCalled();
  act(() => { moved = ref.current!.scrollToItem(`visible-${resource}`); });
  expect(moved).toBe(true);
  expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 300 + 22 - 36, behavior: 'smooth' }));
});
